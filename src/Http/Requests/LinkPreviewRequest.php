<?php

namespace Plugins\G7\Ckeditor5\Superpack\Http\Requests;

use App\Rules\PublicOutboundUrl;
use Illuminate\Foundation\Http\FormRequest;

/**
 * 링크 프리뷰 요청 검증.
 *
 * `url` 은 서버가 대신 호출할 목적지이므로 SSRF 방어가 1차 관문이다. 링크 프리뷰는
 * 사내 서버를 가리킬 정당한 이유가 없으므로 `allowInternalOptIn: false` 로,
 * `security.allow_internal_outbound_urls` 설정과 무관하게 항상 내부망을 차단한다.
 * (서비스 계층에서도 해석 IP 재검증을 하지만, 잘못된 입력은 여기서 먼저 걸러 낸다.)
 */
class LinkPreviewRequest extends FormRequest
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
            'url' => [
                'required',
                'string',
                'max:2048',
                'starts_with:http://,https://',
                new PublicOutboundUrl(['http', 'https'], false),
            ],
        ];
    }
}
