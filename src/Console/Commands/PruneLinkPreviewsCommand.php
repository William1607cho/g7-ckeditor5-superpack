<?php

namespace Plugins\G7\Ckeditor5\Superpack\Console\Commands;

use Illuminate\Console\Command;
use Plugins\G7\Ckeditor5\Superpack\Services\LinkPreviewService;

/**
 * 외부 링크 카드(OG 프리뷰) 캐시 정리.
 *
 * - 상태별 TTL(성공 `linkcard_ttl_ok_days`, 실패 `linkcard_ttl_fail_hours`)이 지난 행을
 *   `fetched_at` 오래된 순으로 나눠 지운다. 지워진 링크는 다음 조회 때 다시 가져오므로
 *   지금 동작(만료 행 재취득)과 결과가 같다.
 * - 남은 행이 `LinkPreviewService::MAX_ROWS` 를 넘으면 오래된 행부터 지운다.
 * - 설정 조회에 실패하면 기본 TTL(7일/24시간)로 동작한다.
 *
 * @example php artisan g7-ckeditor5-superpack:prune-link-previews --dry-run
 * @example php artisan g7-ckeditor5-superpack:prune-link-previews --scheduled
 */
class PruneLinkPreviewsCommand extends Command
{
    protected $signature = 'g7-ckeditor5-superpack:prune-link-previews
                            {--dry-run : 지우지 않고 대상 건수만 출력}
                            {--scheduled : 스케줄러 호출 표시}';

    protected $description = 'TTL 이 지난 외부 링크 카드 캐시와 최대 행 수 초과분을 정리합니다.';

    public function __construct(
        protected LinkPreviewService $linkPreviewService,
    ) {
        parent::__construct();
    }

    public function handle(): int
    {
        $dryRun = (bool) $this->option('dry-run');
        $result = $this->linkPreviewService->prune($dryRun);

        $key = $dryRun ? 'prune_dry_run' : 'prune_done';
        $this->info(__('g7-ckeditor5-superpack::messages.link_preview.'.$key, [
            'expired' => $result['expired'],
            'overflow' => $result['overflow'],
            'remaining' => $result['remaining'],
            'max' => LinkPreviewService::MAX_ROWS,
        ]));

        return self::SUCCESS;
    }
}
