<?php

namespace Plugins\G7\Ckeditor5\Superpack\Listeners;

use App\Contracts\Extension\HookListenerInterface;
use App\Support\ImageResizer;
use Illuminate\Http\UploadedFile;
use Plugins\G7\Ckeditor5\Superpack\Support\ImagePasteWebpConverter;

/**
 * "PNG→WebP 자동 변환"(`imagepaste_webp_enabled`)을 모든 이미지 업로드 경로에
 * 적용하는 통합 리스너 — 이 플러그인이 소유하는 8개 필터 훅을 전부 구독한다.
 *
 * 이 리스너 하나로 다음 8곳을 전부 커버한다:
 *
 *  - `sirsoft-ckeditor5.image.filter_upload_file`   (게시글 본문 에디터 이미지)
 *  - `core.attachment.filter_upload_file`           (g7 코어 관리자/일반 첨부)
 *  - `core.template_layout_attachment.filter_upload_file` (템플릿 레이아웃 첨부)
 *  - `sirsoft-board.attachment.filter_upload_file`  (게시판 첨부, 벤더 모듈)
 *  - `sirsoft-ecommerce.category-image.filter_upload_file` (쇼핑몰 카테고리 이미지)
 *  - `sirsoft-ecommerce.product-image.filter_upload_file`  (쇼핑몰 상품 이미지)
 *  - `sirsoft-ecommerce.review-image.filter_upload_file`   (쇼핑몰 리뷰 이미지)
 *  - `sirsoft-page.attachment.filter_upload_file`   (페이지 첨부, 벤더 모듈)
 *
 * 8개 훅 전부 시그니처가 동일하다 — `UploadedFile` 하나를 받아 하나를 돌려주고,
 * 직후 호스트 코드가 자체적으로 `App\Support\ImageResizer::resizeInPlace()`를
 * 한 번 더 호출한다(g7 코어 정식 업스트림 기능, v7.0.6+ — 손대지 않는다).
 *
 * 이 리스너는 **호스트의 resizeInPlace() 호출보다 먼저** 리사이즈까지 끝내고
 * 그다음 변환한다 — 반대 순서(변환 먼저)로 하면, 이 서버의 GD는 WebP 인코딩을
 * 지원하지 않아(별도 조사에서 확인됨) 호스트의 뒤이은 resizeInPlace() 재호출이
 * 조용히 실패할 수 있다. 이미 상한 이내로 줄인 이미지에 대한 호스트의 재호출은
 * 자연히 무동작(scale>=1.0)이라 중복 호출 자체는 안전하다.
 *
 * 변환이 일어났다면 원본 파일명만 확장자를 `.webp`로 바꾼 새 `UploadedFile`을
 * 돌려준다 — 8곳 중 절반은 저장 확장자를 파일 내용 재감지(`guessExtension()`/
 * `extension()`, 캐시 없이 매번 새로 finfo 검사)로 정하지만 나머지 절반은
 * 클라이언트가 보낸 원본 파일명(`getClientOriginalExtension()`, 내용과 무관)을
 * 그대로 쓴다 — 구분해서 처리하는 대신 8곳 전부 동일하게 새 `UploadedFile`을
 * 돌려주는 쪽이 더 단순하고, 내용 재감지 경로에서도 부작용이 없다(어차피 같은
 * 결론에 도달하므로).
 *
 * v1.2.0까지는 이 변환 엔진(`ImagePasteWebpConverter`)이 g7 코어
 * (`App\Support\ImageResizer`)에 직접 패치돼 있었다 — 이 플러그인만 다른 g7
 * 사이트에 설치하면 설정 체크박스는 있어도 조용히 무동작했다(v1.2.0 release
 * notes/`plugin.php` docblock 참고). v1.2.1에서 이 리스너 + `ImagePasteWebpConverter`
 * 로 옮겨와 코어 패치를 완전히 제거했다 — 이 플러그인만 설치해도 전체 기능이
 * 동작한다.
 */
class ImagePasteWebpConversionListener implements HookListenerInterface
{
    private const SUBSCRIBED_HOOKS = [
        'sirsoft-ckeditor5.image.filter_upload_file',
        'core.attachment.filter_upload_file',
        'core.template_layout_attachment.filter_upload_file',
        'sirsoft-board.attachment.filter_upload_file',
        'sirsoft-ecommerce.category-image.filter_upload_file',
        'sirsoft-ecommerce.product-image.filter_upload_file',
        'sirsoft-ecommerce.review-image.filter_upload_file',
        'sirsoft-page.attachment.filter_upload_file',
    ];

    /**
     * 구독 훅 메타데이터. 8개 훅 전부 동일 로직으로 처리한다.
     *
     * @return array<string, array<string, mixed>>
     */
    public static function getSubscribedHooks(): array
    {
        return array_fill_keys(self::SUBSCRIBED_HOOKS, [
            'method' => 'filter',
            'priority' => 10,
            'type' => 'filter',
        ]);
    }

    /**
     * filter 전용 listener — handle은 호출되지 않습니다.
     *
     * @param  mixed  ...$args
     */
    public function handle(...$args): void
    {
        // filter 전용 — 기본 핸들러는 미사용
    }

    /**
     * 업로드 파일이 PNG면 리사이즈 → WebP 재인코딩을 시도하고, 변환됐다면 확장자가
     * 반영된 새 UploadedFile을 반환합니다. 변환 대상이 아니거나(PNG가 아님) 설정이
     * 꺼져 있거나 실패하면 원본을 그대로 돌려줍니다.
     *
     * @param  UploadedFile  $file  업로드된 파일
     * @param  mixed  ...$args  추가 컨텍스트 (현재 사용 안 함)
     */
    public function filter(UploadedFile $file, ...$args): UploadedFile
    {
        if (! plugin_setting('g7-ckeditor5-superpack', 'imagepaste_webp_enabled', true)) {
            return $file;
        }

        $originalMimeType = $file->getMimeType();

        // 호스트가 이 훅 직후 자체적으로도 resizeInPlace()를 한 번 더 호출한다(g7
        // 코어 정식 기능이라 건드리지 않는다) — 여기서 리사이즈까지 먼저 끝내 둬야
        // "리사이즈 → 변환" 순서가 지켜진다.
        app(ImageResizer::class)->resizeInPlace($file->getRealPath(), $originalMimeType);

        $convertedMimeType = app(ImagePasteWebpConverter::class)
            ->convertInPlace($file->getRealPath(), $originalMimeType);

        if ($convertedMimeType === null) {
            return $file;
        }

        $baseName = pathinfo($file->getClientOriginalName(), PATHINFO_FILENAME);

        return new UploadedFile(
            $file->getRealPath(),
            ($baseName !== '' ? $baseName : 'image').'.webp',
            $convertedMimeType,
        );
    }
}
