<?php

namespace Plugins\G7\Ckeditor5\Superpack\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * 동영상 청크 업로드 세션 시작 요청.
 *
 * 실제 크기/확장자/MIME 상한 검증은 `VideoUploadService::init()` 이 설정값 기준으로 수행한다
 * (여기서는 구조적 형태만 본다).
 */
class VideoUploadInitRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // 라우트 게이트(auth:sanctum + admin)가 인가 전담
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'filename' => ['required', 'string', 'max:255'],
            'size' => ['required', 'integer', 'min:1'],
            'mime' => ['nullable', 'string', 'max:100'],
            'total_chunks' => ['required', 'integer', 'min:1', 'max:100000'],
        ];
    }
}
