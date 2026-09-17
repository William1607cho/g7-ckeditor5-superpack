<?php

namespace Plugins\G7\Ckeditor5\Superpack\Tests\Feature;

require_once dirname(__DIR__).'/PluginTestCase.php';

use App\Extension\PluginManager;
use Illuminate\Support\Facades\Artisan;
use Plugins\G7\Ckeditor5\Superpack\Models\LinkPreview;
use Plugins\G7\Ckeditor5\Superpack\Services\LinkPreviewService;
use Plugins\G7\Ckeditor5\Superpack\Tests\PluginTestCase;

/**
 * 링크 카드 캐시 정리 (1.4.0)
 *
 * - 상태별 TTL(기본 성공 7일 / 실패 24시간)이 지난 행만 삭제
 * - --dry-run 은 아무것도 지우지 않음
 * - 최대 행 수 초과분은 오래된 행부터 삭제
 * - 명령 등록·옵션, 스케줄 등록(prune-videos 와 다른 시각)
 *
 * 테스트 DB 의 기존 행도 정리 대상이 될 수 있어, 건수는 "최소" 로만 단언하고
 * 개별 행의 존재 여부로 판정한다. 지워진 기존 행은 트랜잭션 롤백으로 되돌아온다.
 * TTL 설정이 기본값이 아닌 환경이면 경계 테스트를 건너뛴다.
 */
class PruneLinkPreviewsTest extends PluginTestCase
{
    private const COMMAND = 'g7-ckeditor5-superpack:prune-link-previews';

    private function pruner(): LinkPreviewService
    {
        return app(LinkPreviewService::class);
    }

    private function skipUnlessDefaultTtl(): void
    {
        $ok = $this->pruner()->staleThreshold('ok');
        $fail = $this->pruner()->staleThreshold('failed');

        if (abs($ok->diffInHours(now()->subDays(7))) > 1 || abs($fail->diffInMinutes(now()->subHours(24))) > 5) {
            $this->markTestSkipped('TTL 설정이 기본값(7일/24시간)이 아닌 환경이다.');
        }
    }

    private function exists(LinkPreview $row): bool
    {
        return LinkPreview::query()->whereKey($row->getKey())->exists();
    }

    public function test_default_ttl_thresholds(): void
    {
        $this->skipUnlessDefaultTtl();

        $this->assertEqualsWithDelta(now()->subDays(7)->timestamp, $this->pruner()->staleThreshold('ok')->timestamp, 5);
        $this->assertEqualsWithDelta(now()->subDays(7)->timestamp, $this->pruner()->staleThreshold('minimal')->timestamp, 5);
        $this->assertEqualsWithDelta(now()->subHours(24)->timestamp, $this->pruner()->staleThreshold('empty')->timestamp, 5);
        $this->assertEqualsWithDelta(now()->subHours(24)->timestamp, $this->pruner()->staleThreshold('failed')->timestamp, 5);
        // 알 수 없는 상태는 실패 TTL
        $this->assertEqualsWithDelta(now()->subHours(24)->timestamp, $this->pruner()->staleThreshold('other')->timestamp, 5);
    }

    public function test_expired_rows_are_deleted_by_status_ttl(): void
    {
        $this->skipUnlessDefaultTtl();

        $okOld = $this->makeRow('ok', now()->subDays(8));
        $okFresh = $this->makeRow('ok', now()->subDays(6));
        $minimalOld = $this->makeRow('minimal', now()->subDays(8));
        $minimalFresh = $this->makeRow('minimal', now()->subHours(30));
        $failedOld = $this->makeRow('failed', now()->subHours(25));
        $failedFresh = $this->makeRow('failed', now()->subHours(23));
        $emptyOld = $this->makeRow('empty', now()->subDays(2));
        $emptyFresh = $this->makeRow('empty', now()->subMinutes(10));

        $result = $this->pruner()->prune();

        $this->assertGreaterThanOrEqual(4, $result['expired']);
        $this->assertSame(0, $result['overflow']);

        $this->assertFalse($this->exists($okOld));
        $this->assertFalse($this->exists($minimalOld));
        $this->assertFalse($this->exists($failedOld));
        $this->assertFalse($this->exists($emptyOld));

        $this->assertTrue($this->exists($okFresh));
        $this->assertTrue($this->exists($minimalFresh));
        $this->assertTrue($this->exists($failedFresh));
        $this->assertTrue($this->exists($emptyFresh));

        $this->assertSame(LinkPreview::query()->count(), $result['remaining']);
    }

    public function test_dry_run_deletes_nothing(): void
    {
        $this->skipUnlessDefaultTtl();

        $old = $this->makeRow('ok', now()->subDays(30));
        $this->makeRow('failed', now()->subDays(3));
        $before = LinkPreview::query()->count();

        $result = $this->pruner()->prune(dryRun: true);

        $this->assertGreaterThanOrEqual(2, $result['expired']);
        $this->assertSame($before, LinkPreview::query()->count());
        $this->assertTrue($this->exists($old));
        $this->assertSame($before - $result['expired'] - $result['overflow'], $result['remaining']);
    }

    public function test_overflow_deletes_oldest_rows_first(): void
    {
        // 기존 행보다 확실히 최근인 행 5개
        $rows = [];
        for ($i = 1; $i <= 5; $i++) {
            $rows[$i] = $this->makeRow('ok', now()->addMinutes($i));
        }
        $total = LinkPreview::query()->count();
        $max = $total - 3;

        $dry = $this->pruner()->prune(dryRun: true, maxRows: $max);
        $this->assertSame($total, LinkPreview::query()->count());

        $result = $this->pruner()->prune(maxRows: $max);
        $after = LinkPreview::query()->count();

        // 만료 행이 3건보다 많으면 상한보다 더 줄어들 수 있다
        $this->assertLessThanOrEqual($max, $after);
        $this->assertSame($after, $result['remaining']);
        $this->assertSame($total - $after, $result['expired'] + $result['overflow']);
        $this->assertGreaterThanOrEqual($total - $max, $result['expired'] + $result['overflow']);
        $this->assertSame([$dry['expired'], $dry['overflow'], $dry['remaining']], [$result['expired'], $result['overflow'], $result['remaining']]);

        // 가장 최근 두 행은 남는다
        $this->assertTrue($this->exists($rows[5]));
        $this->assertTrue($this->exists($rows[4]));
    }

    public function test_overflow_on_only_new_rows_removes_the_oldest_of_them(): void
    {
        $base = LinkPreview::query()->count();
        $a = $this->makeRow('ok', now()->addMinutes(1));
        $b = $this->makeRow('ok', now()->addMinutes(2));
        $c = $this->makeRow('ok', now()->addMinutes(3));

        // 기존 행을 모두 지우고도 1건 더 지워야 하는 상한
        $result = $this->pruner()->prune(maxRows: 2);

        $this->assertSame(2, LinkPreview::query()->count());
        $this->assertFalse($this->exists($a));
        $this->assertTrue($this->exists($b));
        $this->assertTrue($this->exists($c));
        $this->assertSame($base + 3 - 2, $result['expired'] + $result['overflow']);
    }

    public function test_default_max_rows_constant(): void
    {
        $this->assertSame(50_000, LinkPreviewService::MAX_ROWS);
    }

    public function test_command_is_registered_with_options(): void
    {
        if (! array_key_exists(self::COMMAND, Artisan::all())) {
            $this->markTestSkipped('플러그인이 활성화돼 커맨드가 등록된 환경에서만 실행한다.');
        }

        $definition = Artisan::all()[self::COMMAND]->getDefinition();
        $this->assertTrue($definition->hasOption('dry-run'));
        $this->assertTrue($definition->hasOption('scheduled'));
    }

    public function test_command_dry_run_keeps_rows(): void
    {
        if (! array_key_exists(self::COMMAND, Artisan::all())) {
            $this->markTestSkipped('플러그인이 활성화돼 커맨드가 등록된 환경에서만 실행한다.');
        }

        $old = $this->makeRow('ok', now()->subDays(365));
        $before = LinkPreview::query()->count();

        $this->artisan(self::COMMAND, ['--dry-run' => true, '--scheduled' => true])->assertExitCode(0);

        $this->assertSame($before, LinkPreview::query()->count());
        $this->assertTrue($this->exists($old));
    }

    public function test_command_deletes_expired_rows(): void
    {
        if (! array_key_exists(self::COMMAND, Artisan::all())) {
            $this->markTestSkipped('플러그인이 활성화돼 커맨드가 등록된 환경에서만 실행한다.');
        }

        $old = $this->makeRow('failed', now()->subDays(365));
        $fresh = $this->makeRow('ok', now());

        $this->artisan(self::COMMAND, ['--scheduled' => true])->assertExitCode(0);

        $this->assertFalse($this->exists($old));
        $this->assertTrue($this->exists($fresh));
    }

    public function test_schedule_is_declared_at_a_different_time_from_video_prune(): void
    {
        $plugin = app()->bound(PluginManager::class) ? app(PluginManager::class)->getPlugin(self::IDENTIFIER) : null;
        if ($plugin === null) {
            $this->markTestSkipped('플러그인이 설치된 환경에서만 실행한다.');
        }

        $schedules = collect($plugin->getSchedules())->keyBy(fn ($s) => strtok($s['command'], ' '));

        $this->assertTrue($schedules->has(self::COMMAND));
        $this->assertTrue($schedules->has('g7-ckeditor5-superpack:prune-videos'));
        $this->assertStringContainsString('--scheduled', $schedules[self::COMMAND]['command']);
        $this->assertSame('30 0 * * *', $schedules[self::COMMAND]['schedule']);
        $this->assertNotSame($schedules['g7-ckeditor5-superpack:prune-videos']['schedule'], $schedules[self::COMMAND]['schedule']);
    }
}
