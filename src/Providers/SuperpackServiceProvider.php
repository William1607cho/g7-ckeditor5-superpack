<?php

namespace Plugins\G7\Ckeditor5\Superpack\Providers;

use App\Extension\BasePluginServiceProvider;
use Plugins\G7\Ckeditor5\Superpack\Console\Commands\PruneVideosCommand;
use Plugins\G7\Ckeditor5\Superpack\Services\VideoUploadService;

/**
 * CKEditor 5 슈퍼팩 서비스 프로바이더.
 *
 * - `VideoUploadService` 에 플러그인 격리 `StorageInterface` 자동 주입
 *   (BasePluginServiceProvider 표준: `plugins` 디스크의 `g7-ckeditor5-superpack/` 하위).
 * - 콘솔 실행 시 미참조 동영상/만료 세션 정리 커맨드 등록.
 * - `lang/{locale}/messages.php` 를 `g7-ckeditor5-superpack::messages.*` 네임스페이스로 로드.
 *
 * (SNS 임베드·링크 카드 기능은 전부 프론트/전용 라우트라 별도 바인딩이 필요 없다 —
 *  `LinkPreviewService` 는 Http 파사드·정적 검증기만 쓰므로 컨테이너 자동 해석으로 충분.)
 */
class SuperpackServiceProvider extends BasePluginServiceProvider
{
    protected string $pluginIdentifier = 'g7-ckeditor5-superpack';

    /**
     * 기본 StorageInterface 주입이 필요한 서비스.
     *
     * @var array<class-string>
     */
    protected array $storageServices = [
        VideoUploadService::class,
    ];

    /**
     * 플러그인 부팅 — 콘솔 실행 시 정리 커맨드 등록.
     */
    public function boot(): void
    {
        parent::boot();

        if ($this->app->runningInConsole()) {
            $this->commands([
                PruneVideosCommand::class,
            ]);
        }
    }
}
