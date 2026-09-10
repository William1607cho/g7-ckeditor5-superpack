<?php

use Illuminate\Support\Facades\Route;
use Plugins\G7\Ckeditor5\Superpack\Http\Controllers\LinkPreviewController;
use Plugins\G7\Ckeditor5\Superpack\Http\Controllers\VideoServeController;
use Plugins\G7\Ckeditor5\Superpack\Http\Controllers\VideoUploadController;

/*
 * g7-ckeditor5-superpack 플러그인 API 라우트
 *
 * URL prefix: /api/plugins/g7-ckeditor5-superpack (PluginRouteServiceProvider 자동 적용)
 */

// 외부 링크 OG 카드 프리뷰 (공개 접근).
// 서버가 대상 URL 을 대신 fetch → SSRF 방어(Request 코어 규칙 + Service 해석 IP 재검증).
Route::get('link-preview', [LinkPreviewController::class, 'show'])
    ->middleware('throttle:60,1')
    ->name('api.g7-ckeditor5-superpack.link-preview');

/*
| 로컬 동영상 청크 업로드 (관리자 인증 — AdminBaseController 가 auth:sanctum + admin 적용).
| init/complete 는 낮게, chunk 는 대용량 다청크를 감안해 높게 throttle.
*/
Route::post('video/upload/init', [VideoUploadController::class, 'init'])
    ->middleware('throttle:60,1')
    ->name('api.g7-ckeditor5-superpack.video.init');

Route::post('video/upload/chunk', [VideoUploadController::class, 'chunk'])
    ->middleware('throttle:1200,1')
    ->name('api.g7-ckeditor5-superpack.video.chunk');

Route::post('video/upload/complete', [VideoUploadController::class, 'complete'])
    ->middleware('throttle:60,1')
    ->name('api.g7-ckeditor5-superpack.video.complete');

// 편집 화면 미디어 라이브러리 — 본문이 참조하는 동영상 id 들의 메타 일괄 조회 (관리자).
Route::post('video/meta', [VideoUploadController::class, 'meta'])
    ->middleware('throttle:120,1')
    ->name('api.g7-ckeditor5-superpack.video.meta');

// 동영상 스트리밍 (공개 — 추측 불가 public_id, Range 자동 지원).
Route::get('video/{id}', [VideoServeController::class, 'show'])
    ->where('id', '[a-f0-9]{32}')
    ->middleware('throttle:600,1')
    ->name('api.g7-ckeditor5-superpack.video.serve');
