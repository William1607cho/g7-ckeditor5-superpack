<?php

namespace Plugins\G7\Ckeditor5\Superpack\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * 다운로드/서빙 응답의 `Content-Disposition` 파일명 확장자를 실제
 * `Content-Type`에 맞게 보정하는 미들웨어.
 *
 * 배경(실사고, v1.2.0 라운드에서 확인): PNG로 업로드된 이미지가 WebP로 재인코딩돼
 * 저장돼도, 여러 서빙 지점이 파일명으로 쓰는 "원본 업로드 시점 파일명"(예:
 * "image.png")은 갱신되지 않는다 — 그 결과 실제 내용은 WebP인데 브라우저가
 * "다른 이름으로 저장"에 제안하는 파일명만 여전히 .png로 나가, 사용자가 "변환이
 * 안 됐다"고 오인하는 문제가 있었다.
 *
 * v1.2.0에서는 이걸 g7 코어·`sirsoft-ckeditor5` 플러그인의 서빙 코드 각각에
 * 직접 패치해 해결했지만, 그러면 이 플러그인만 다른 사이트에 설치해도 그 수정이
 * 따라가지 않는다. 이 미들웨어는 **응답 헤더만 보고** 판단하므로(실제 저장 방식이나
 * DB 필드가 무엇이든 무관) 대상 라우트를 건드리지 않고도 동일한 효과를 낸다 —
 * `Content-Type`이 알려진 이미지 MIME이고 `Content-Disposition`의 파일명 확장자가
 * 그와 다르면, 파일명 "몸통"은 그대로 두고 확장자만 실제 내용에 맞게 고친다.
 *
 * 적용 대상은 `plugin.php`의 `getMiddleware()` targets로 한정된다(자기 라우트 +
 * g7 코어 첨부/템플릿 레이아웃 첨부 서빙 라우트) — 전역 미들웨어가 아니다.
 */
class CorrectDownloadFilenameExtension
{
    /**
     * 서버가 실제로 만들어낼 수 있는 이미지 MIME → 정규 확장자 매핑.
     * (ImageResizer::SUPPORTED와 동일한 포맷 범위 — jpeg/png/gif/webp)
     */
    private const MIME_EXTENSIONS = [
        'image/webp' => 'webp',
        'image/png' => 'png',
        'image/jpeg' => 'jpg',
        'image/gif' => 'gif',
    ];

    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        if (! $response instanceof Response) {
            return $response;
        }

        $contentType = $response->headers->get('Content-Type');
        $mime = $contentType !== null
            ? strtolower(trim(explode(';', $contentType)[0]))
            : null;
        $correctExtension = $mime !== null ? (self::MIME_EXTENSIONS[$mime] ?? null) : null;

        if ($correctExtension === null) {
            return $response;
        }

        $disposition = $response->headers->get('Content-Disposition');

        if ($disposition === null || ! preg_match('/filename="?([^";]+)"?/', $disposition, $matches)) {
            return $response;
        }

        $filename = $matches[1];
        $currentExtension = strtolower(pathinfo($filename, PATHINFO_EXTENSION));

        if ($currentExtension === $correctExtension) {
            return $response;
        }

        $base = pathinfo($filename, PATHINFO_FILENAME);
        $newFilename = ($base !== '' ? $base : 'image').'.'.$correctExtension;

        $newDisposition = preg_replace(
            '/filename="?[^";]+"?/',
            'filename="'.$newFilename.'"',
            $disposition,
            1
        );

        $response->headers->set('Content-Disposition', $newDisposition);

        return $response;
    }
}
