<?php

namespace Plugins\G7\Ckeditor5\Superpack\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * 청크 하나 수신 요청 (multipart: session_key, index, chunk[file]).
 *
 * `max:30720` (30MB) 은 청크 크기 설정 상한(28MB) 위의 안전 여유값이며, PHP
 * `upload_max_filesize`(35M) 아래다. 실제 청크별 상한은 서비스가 세션의 `chunk_size`
 * 로 재확인한다.
 */
class VideoChunkRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'session_key' => ['required', 'string', 'size:40', 'alpha_num'],
            'index' => ['required', 'integer', 'min:0', 'max:99999'],
            'chunk' => ['required', 'file', 'max:30720'],
        ];
    }
}
