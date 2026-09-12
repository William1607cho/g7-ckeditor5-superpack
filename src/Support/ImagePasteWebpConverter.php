<?php

namespace Plugins\G7\Ckeditor5\Superpack\Support;

use Illuminate\Support\Facades\Log;

/**
 * PNG로 업로드된 이미지를 제자리에서 WebP로 재인코딩합니다 ("이미지 복붙" 탭의
 * "업로드 이미지 PNG→WebP 자동 변환" 설정이 실제로 소비하는 엔진).
 *
 * 배경: Chrome 등 브라우저가 클립보드 "이미지 복사" 시 원본 포맷과 무관하게 항상
 * 무손실 비트맵(PNG)으로 재구성해 클립보드에 담는 표준 동작 때문에, 원래 WebP였던
 * 이미지를 붙여넣으면 PNG(원본 대비 수 배 용량)로 업로드되는 문제가 있다. 이 클래스는
 * 그렇게 들어온 PNG를 저장 직전에 WebP로 다시 인코딩해 용량만 되돌린다 — 브라우저
 * 클립보드 동작 자체는 코드로 막을 수 없으므로, 서버가 마지막 지점에서 보정한다.
 *
 * 이 클래스는 온전히 이 플러그인 소속이다 — 이전 버전에서는 이 로직이 g7 코어의
 * `App\Support\ImageResizer`에 직접 패치돼 있었으나, 그러면 이 플러그인을 다른
 * 사이트에 설치해도 "PNG→WebP 자동 변환" 체크박스가 조용히 무동작했다. 리사이즈
 * (`App\Support\ImageResizer::resizeInPlace()`)는 g7 코어의 정식 업스트림 기능
 * (v7.0.6+)이라 그대로 코어에 남겨두고, 이 클래스는 그 리사이즈 *이후* 단계에서만
 * 개입한다 — 호출 순서(리사이즈 → 변환)는 `ImagePasteWebpConversionListener`가 보장한다.
 */
class ImagePasteWebpConverter
{
    /**
     * PNG→WebP 무손실 변환 결과가 원본 대비 이 비율 미만으로만 줄면(=별 이득 없으면)
     * 손실 압축(WEBP_LOSSY_QUALITY)으로 폴백한다.
     */
    private const WEBP_LOSSLESS_MIN_SAVINGS_RATIO = 0.90;

    /**
     * 손실 압축 폴백 시 사용할 WebP 품질 (1~100). 화질 손실 우려가 있으므로 고품질 기본값.
     */
    private const WEBP_LOSSY_QUALITY = 90;

    /**
     * PNG 가 아닌 입력(JPEG·WebP·GIF 등 이미 효율적인 포맷)은 건드리지 않는다 — 이미
     * 로시(lossy)로 압축된 파일을 다시 무손실 컨테이너로 왕복시키거나, GIF 애니메이션을
     * 깨뜨릴 이유가 없다.
     *
     * 안전장치: 변환 결과가 원본보다 크거나 같으면(드물지만 발생 가능) 변환을 적용하지
     * 않고 원본 PNG를 그대로 둔다 — "재인코딩"이라는 이유만으로 역효과가 나면 안 된다.
     *
     * @param  string  $path  이미지 파일 절대 경로 (제자리 수정)
     * @param  string|null  $mimeType  파일 MIME 타입 (원본 업로드 시점 기준 — 리사이즈는
     *                                  포맷을 바꾸지 않으므로 리사이즈 후에 불러도 동일하다)
     * @return string|null 변환을 적용했으면 새 MIME 타입("image/webp"), 아니면 null(원본 유지)
     */
    public function convertInPlace(string $path, ?string $mimeType): ?string
    {
        if (strtolower((string) $mimeType) !== 'image/png') {
            return null;
        }

        if (! extension_loaded('imagick') || ! is_file($path)) {
            return null;
        }

        // 이전 단계(리사이즈 등)가 is_file()/getimagesize() 로 이 경로를 이미 stat 했을
        // 수 있다 — clearstatcache 없이 filesize() 를 읽으면 리사이즈 전 크기가 나올 수 있다.
        clearstatcache(true, $path);
        $originalSize = filesize($path);

        if ($originalSize === false || $originalSize <= 0) {
            return null;
        }

        try {
            if (! in_array('WEBP', \Imagick::queryFormats('WEBP'), true)) {
                return null;
            }

            $best = $this->encodeWebp($path, lossless: true, quality: null);

            // 무손실 결과가 원본 대비 별로 안 줄면(90% 이상) 고품질 손실 압축으로 폴백한다.
            if ($best === null || strlen($best) > $originalSize * self::WEBP_LOSSLESS_MIN_SAVINGS_RATIO) {
                $lossy = $this->encodeWebp($path, lossless: false, quality: self::WEBP_LOSSY_QUALITY);

                if ($lossy !== null && ($best === null || strlen($lossy) < strlen($best))) {
                    $best = $lossy;
                }
            }

            // 변환해도 원본보다 커지거나 같으면 이득이 없으므로 원본 PNG를 그대로 둔다.
            if ($best === null || strlen($best) >= $originalSize) {
                return null;
            }

            file_put_contents($path, $best);
            clearstatcache(true, $path);

            return 'image/webp';
        } catch (\Throwable $e) {
            // 변환 실패가 업로드 자체를 막지는 않는다 — 원본 PNG가 그대로 저장된다
            Log::warning('[g7-ckeditor5-superpack] PNG→WebP 변환 실패 (원본을 그대로 저장합니다)', [
                'path' => $path,
                'error' => $e->getMessage(),
            ]);

            return null;
        }
    }

    /**
     * Imagick으로 이미지를 WebP로 인코딩한 바이트열을 반환합니다 (파일에 쓰지 않음).
     *
     * @param  string  $path  원본 이미지 경로
     * @param  bool  $lossless  true면 무손실, false면 $quality로 손실 압축
     * @param  int|null  $quality  손실 압축 품질(1~100), 무손실일 땐 무시
     * @return string|null 인코딩된 바이트열 (실패 시 null)
     */
    private function encodeWebp(string $path, bool $lossless, ?int $quality): ?string
    {
        $imagick = null;

        try {
            $imagick = new \Imagick($path);
            $imagick->setImageFormat('webp');
            $imagick->setOption('webp:lossless', $lossless ? 'true' : 'false');

            if (! $lossless && $quality !== null) {
                $imagick->setImageCompressionQuality($quality);
            }

            $blob = $imagick->getImageBlob();

            return $blob !== '' ? $blob : null;
        } catch (\Throwable $e) {
            return null;
        } finally {
            if ($imagick instanceof \Imagick) {
                $imagick->clear();
                $imagick->destroy();
            }
        }
    }
}
