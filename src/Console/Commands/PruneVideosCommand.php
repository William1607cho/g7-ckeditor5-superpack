<?php

namespace Plugins\G7\Ckeditor5\Superpack\Console\Commands;

use Illuminate\Console\Command;
use Plugins\G7\Ckeditor5\Superpack\Services\VideoUploadService;

/**
 * 만료된 동영상 업로드 세션(임시 청크) 정리 + 옵트인 시 미참조 동영상 파일 정리.
 *
 * 만료 세션 temp 정리는 항상 수행한다(디스크에 쌓이는 미완료 청크). 완성 파일 삭제는
 * 설정 `video_retention_days` 가 0 보다 클 때만 — 게시글 동영상이 통째로 사라지는
 * 행위라 기본 무기한(옵트인). `--scheduled` 는 설정 조회 실패 시에도 0(=삭제 안 함)
 * 폴백이므로 안전하다.
 *
 * @example php artisan g7-ckeditor5-superpack:prune-videos
 * @example php artisan g7-ckeditor5-superpack:prune-videos --scheduled
 */
class PruneVideosCommand extends Command
{
    protected $signature = 'g7-ckeditor5-superpack:prune-videos
                            {--scheduled : 스케줄러 호출 표시}';

    protected $description = '만료된 동영상 업로드 세션과 (옵트인 시) 미참조 동영상 파일을 정리합니다.';

    public function __construct(
        protected VideoUploadService $videoUploadService,
    ) {
        parent::__construct();
    }

    public function handle(): int
    {
        $result = $this->videoUploadService->prune((bool) $this->option('scheduled'));

        $this->info(sprintf(
            '정리 완료 — 만료 세션 %d개, 미참조 파일 %d개.',
            $result['sessions'],
            $result['files'],
        ));

        return self::SUCCESS;
    }
}
