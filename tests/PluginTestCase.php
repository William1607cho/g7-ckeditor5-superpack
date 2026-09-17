<?php

namespace Plugins\G7\Ckeditor5\Superpack\Tests;

use App\Extension\PluginManager;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Schema;
use Plugins\G7\Ckeditor5\Superpack\Contracts\LinkPreviewFetcher;
use Plugins\G7\Ckeditor5\Superpack\Models\LinkPreview;
use Plugins\G7\Ckeditor5\Superpack\Services\LinkPreviewService;
use Plugins\G7\Ckeditor5\Superpack\Tests\Support\FakeLinkPreviewFetcher;
use Tests\TestCase;

/**
 * g7-ckeditor5-superpack 테스트 베이스 클래스 (1.4.0)
 *
 * - 데이터 정리는 DatabaseTransactions 롤백으로만 한다. 기존 행을 DELETE/TRUNCATE 하지 않는다.
 *   (정리 명령 테스트가 지운 기존 행도 롤백으로 되돌아온다.)
 * - 외부 HTTP 요청은 하지 않는다. `LinkPreviewService` 는 가짜 수신기로 돌린다.
 *   `CurlLinkPreviewFetcherTest` 만 테스트가 직접 띄운 루프백 서버에 접속한다.
 * - 이 플러그인은 번들(`plugins/_bundled`)이 아니고, 코어 테스트 bootstrap 이 디렉터리명으로
 *   계산하는 네임스페이스(`Plugins\G7\Ckeditor5\Tests\`)와 실제 네임스페이스가 달라
 *   자동 로드되지 않는다. 각 테스트 파일은 이 파일을 `require_once` 로 불러오고,
 *   여기서 플러그인 클래스 오토로드를 직접 등록한다.
 * - 실행은 플러그인이 설치된 테스트 전용 DB 에서 경로를 직접 지정한다.
 */
abstract class PluginTestCase extends TestCase
{
    use DatabaseTransactions;

    public const IDENTIFIER = 'g7-ckeditor5-superpack';

    /** 테스트에서 빈도 한도 키를 비울 호스트 */
    protected const TEST_HOSTS = ['1.1.1.1', '8.8.8.8', '9.9.9.9', '2606:4700:4700::1111'];

    protected function setUp(): void
    {
        parent::setUp();

        self::registerPluginAutoload();

        if (! Schema::hasTable((new LinkPreview)->getTable())) {
            $this->markTestSkipped('g7-ckeditor5-superpack 이 설치된(마이그레이션된) 테스트 환경에서만 실행한다.');
        }

        $this->clearRateLimits();
    }

    protected function tearDown(): void
    {
        $this->clearRateLimits();
        LinkPreview::flushEventListeners();

        parent::tearDown();
    }

    /**
     * composer.json 의 PSR-4 매핑(`src/`, `./`)과 같은 규칙으로 오토로드를 등록한다.
     */
    public static function registerPluginAutoload(): void
    {
        static $registered = false;
        if ($registered) {
            return;
        }
        $registered = true;

        $base = dirname(__DIR__);

        spl_autoload_register(function ($class) use ($base) {
            $prefix = 'Plugins\\G7\\Ckeditor5\\Superpack\\';
            if (strncmp($prefix, $class, strlen($prefix)) !== 0) {
                return;
            }

            $relative = str_replace('\\', '/', substr($class, strlen($prefix)));
            foreach ([$base.'/src/'.$relative.'.php', $base.'/'.lcfirst($relative).'.php', $base.'/'.$relative.'.php'] as $file) {
                if (file_exists($file) && ! class_exists($class, false)) {
                    require_once $file;

                    return;
                }
            }
        });
    }

    protected function isPluginInstalled(): bool
    {
        return app()->bound(PluginManager::class)
            && app(PluginManager::class)->getPlugin(self::IDENTIFIER) !== null;
    }

    /**
     * 가짜 수신기를 만들고 컨테이너에도 등록한다.
     */
    protected function fakeFetcher(): FakeLinkPreviewFetcher
    {
        $fake = new FakeLinkPreviewFetcher;
        app()->instance(LinkPreviewFetcher::class, $fake);

        return $fake;
    }

    protected function service(FakeLinkPreviewFetcher $fake): LinkPreviewService
    {
        return new LinkPreviewService($fake);
    }

    protected function globalLimitKey(): string
    {
        return LinkPreviewService::LIMIT_KEY_PREFIX.':global';
    }

    protected function hostLimitKey(string $host): string
    {
        return LinkPreviewService::LIMIT_KEY_PREFIX.':host:'.hash('sha256', $host);
    }

    protected function clearRateLimits(): void
    {
        RateLimiter::clear($this->globalLimitKey());
        foreach (self::TEST_HOSTS as $host) {
            RateLimiter::clear($this->hostLimitKey($host));
        }
    }

    /**
     * 캐시 행을 직접 만든다.
     *
     * @param  array<string, mixed>  $attributes
     */
    protected function makeRow(string $status, \DateTimeInterface $fetchedAt, array $attributes = []): LinkPreview
    {
        static $seq = 0;
        $seq++;
        $url = 'https://prune-test.example/'.$seq.'-'.bin2hex(random_bytes(4));

        return LinkPreview::query()->create(array_merge([
            'url_hash' => hash('sha256', $url),
            'url' => $url,
            'status' => $status,
            'fetched_at' => $fetchedAt,
        ], $attributes));
    }
}

// 가짜 수신기는 플러그인 인터페이스를 구현하므로 오토로드 등록 뒤에 불러온다.
PluginTestCase::registerPluginAutoload();
require_once __DIR__.'/Support/FakeLinkPreviewFetcher.php';
