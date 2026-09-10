<?php

namespace Plugins\G7\Ckeditor5\Superpack\Http\Controllers;

use App\Http\Controllers\Api\Base\AdminBaseController;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Plugins\G7\Ckeditor5\Superpack\Http\Requests\VideoChunkRequest;
use Plugins\G7\Ckeditor5\Superpack\Http\Requests\VideoCompleteRequest;
use Plugins\G7\Ckeditor5\Superpack\Http\Requests\VideoUploadInitRequest;
use Plugins\G7\Ckeditor5\Superpack\Models\VideoUpload;
use Plugins\G7\Ckeditor5\Superpack\Services\VideoUploadService;

/**
 * 로컬 동영상 청크 업로드 컨트롤러 (관리자 인증 필요 — 게시판 글쓰기가 관리자 스코프).
 *
 *  POST video/upload/init      → { session_key, chunk_size }
 *  POST video/upload/chunk     → { received, total }
 *  POST video/upload/complete  → { id, url, name }
 *
 * 실패 시 HTTP 4xx + { message } (검증 실패는 사용자 노출용 문구).
 */
class VideoUploadController extends AdminBaseController
{
    public function __construct(
        private readonly VideoUploadService $videoUploadService,
    ) {
        parent::__construct();
    }

    public function init(VideoUploadInitRequest $request): JsonResponse
    {
        if (! $this->videoUploadService->isEnabled()) {
            return response()->json(['message' => __('g7-ckeditor5-superpack::messages.video.err_disabled')], 403);
        }

        try {
            $result = $this->videoUploadService->init(
                $request->validated(),
                $this->getCurrentUser()?->id,
            );
        } catch (\RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        return response()->json($result, 201);
    }

    public function chunk(VideoChunkRequest $request): JsonResponse
    {
        if (! $this->videoUploadService->isEnabled()) {
            return response()->json(['message' => __('g7-ckeditor5-superpack::messages.video.err_disabled')], 403);
        }

        try {
            $result = $this->videoUploadService->receiveChunk(
                (string) $request->input('session_key'),
                (int) $request->input('index'),
                $request->file('chunk'),
            );
        } catch (\RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        return response()->json($result);
    }

    public function complete(VideoCompleteRequest $request): JsonResponse
    {
        if (! $this->videoUploadService->isEnabled()) {
            return response()->json(['message' => __('g7-ckeditor5-superpack::messages.video.err_disabled')], 403);
        }

        try {
            $video = $this->videoUploadService->complete(
                (string) $request->input('session_key'),
                $this->getCurrentUser()?->id,
            );
        } catch (\RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        } catch (\Throwable $e) {
            Log::error('[g7-ckeditor5-superpack] 동영상 complete 오류', ['error' => $e->getMessage()]);

            return response()->json(['message' => __('g7-ckeditor5-superpack::messages.video.err_generic')], 500);
        }

        return response()->json([
            'id' => $video->public_id,
            'url' => "/api/plugins/g7-ckeditor5-superpack/video/{$video->public_id}",
            'name' => $video->original_name,
            'mime' => $video->mime,
        ], 201);
    }

    /**
     * 편집 화면 "미디어 라이브러리" 채우기용 — 여러 public_id 의 메타를 한 번에 조회한다.
     *
     * 게시글 수정 화면 진입 시, 본문에 이미 들어 있는 동영상 링크의 id 들을 프론트가
     * 파싱해 이 엔드포인트로 넘기면, 라이브러리에 그 동영상들이 다시 표시된다.
     * post_id 컬럼 없이 **"현재 본문이 참조하는 것 = 이 글의 동영상"** 으로 정의한다.
     *
     *  POST video/meta  { ids: ["<32hex>", ...] }  →  [ {id, name, mime, url}, ... ]
     */
    public function meta(Request $request): JsonResponse
    {
        $ids = (array) $request->input('ids', []);
        $ids = array_values(array_filter(array_map(
            static fn ($v) => is_string($v) && preg_match('/^[a-f0-9]{32}$/', $v) ? $v : null,
            $ids,
        )));
        if (count($ids) === 0) {
            return response()->json([]);
        }

        $rows = VideoUpload::query()
            ->whereIn('public_id', array_slice($ids, 0, 100))
            ->get(['public_id', 'original_name', 'mime']);

        return response()->json($rows->map(static fn (VideoUpload $v) => [
            'id' => $v->public_id,
            'name' => $v->original_name,
            'mime' => $v->mime,
            'url' => "/api/plugins/g7-ckeditor5-superpack/video/{$v->public_id}",
        ])->all());
    }
}
