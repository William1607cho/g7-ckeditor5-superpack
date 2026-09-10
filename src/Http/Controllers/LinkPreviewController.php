<?php

namespace Plugins\G7\Ckeditor5\Superpack\Http\Controllers;

use App\Http\Controllers\Api\Base\PublicBaseController;
use Illuminate\Http\JsonResponse;
use Plugins\G7\Ckeditor5\Superpack\Http\Requests\LinkPreviewRequest;
use Plugins\G7\Ckeditor5\Superpack\Services\LinkPreviewService;

/**
 * 외부 링크 카드(OG 프리뷰) 컨트롤러.
 *
 * `GET /api/plugins/g7-ckeditor5-superpack/link-preview?url=<encoded>` — 인증 불필요(공개).
 * 응답: { status: "ok"|"minimal"|"empty"|"failed", title, description, image, site_name, favicon, domain }
 *   - ok      : 대표이미지 포함 완전 카드
 *   - minimal : <title> 만 확보 (Cloudflare 챌린지 등) → 제목+도메인+파비콘 최소 카드
 *   - empty/failed : 카드화 불가 → 프론트는 원본 링크 유지
 * 서버가 대신 URL 을 가져오므로 SSRF 방어는 Request(코어 규칙) + Service(해석 IP 재검증) 이중.
 */
class LinkPreviewController extends PublicBaseController
{
    public function __construct(
        private readonly LinkPreviewService $linkPreviewService,
    ) {
        parent::__construct();
    }

    public function show(LinkPreviewRequest $request): JsonResponse
    {
        $data = $this->linkPreviewService->get((string) $request->input('url'));

        // 프론트가 다시 조르지 않도록 브라우저단 짧은 캐시. 서버 캐시(DB)는 설정 TTL.
        return response()->json($data)
            ->header('Cache-Control', 'public, max-age=3600');
    }
}
