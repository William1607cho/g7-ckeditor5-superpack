<?php

namespace Plugins\G7\Ckeditor5\Superpack\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * 청크 조립·완료 요청.
 */
class VideoCompleteRequest extends FormRequest
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
        ];
    }
}
