<?php

namespace Plugins\G7\Ckeditor5\Superpack\Providers;

use App\Extension\BasePluginServiceProvider;
use Plugins\G7\Ckeditor5\Superpack\Console\Commands\PruneLinkPreviewsCommand;
use Plugins\G7\Ckeditor5\Superpack\Console\Commands\PruneVideosCommand;
use Plugins\G7\Ckeditor5\Superpack\Contracts\LinkPreviewFetcher;
use Plugins\G7\Ckeditor5\Superpack\Services\CurlLinkPreviewFetcher;
use Plugins\G7\Ckeditor5\Superpack\Services\VideoUploadService;

/**
 * CKEditor 5 슈퍼팩 서비스 프로바이더.
 *
 * - `VideoUploadService` 에 플러그인 격리 `StorageInterface` 자동 주입
 *   (BasePluginServiceProvider 표준: `plugins` 디스크의 `g7-ckeditor5-superpack/` 하위).
 * - 링크 프리뷰 수신기 `LinkPreviewFetcher` → `CurlLinkPreviewFetcher` 바인딩
 *   (테스트는 `app()->instance()` 로 대체 구현을 넣는다).
 * - 콘솔 실행 시 정리 커맨드 등록 (미참조 동영상/만료 세션, 링크 프리뷰 캐시).
 * - `lang/{locale}/messages.php` 를 `g7-ckeditor5-superpack::messages.*` 네임스페이스로 로드.
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
     * 플러그인 부팅 — 수신기 바인딩, 콘솔 실행 시 정리 커맨드 등록.
     */
    public function boot(): void
    {
        parent::boot();

        $this->app->bindIf(LinkPreviewFetcher::class, CurlLinkPreviewFetcher::class);

        if ($this->app->runningInConsole()) {
            $this->commands([
                PruneVideosCommand::class,
                PruneLinkPreviewsCommand::class,
            ]);
        }
    }
}
