<?php

namespace Plugins\G7\Ckeditor5\Superpack\Support;

/**
 * `LinkPreviewFetcher` 요청 1회의 결과.
 *
 * outcome:
 *  - complete  : 본문을 끝까지 받음
 *  - truncated : 본문이 상한을 넘어 끊음 — `body` 는 상한까지의 앞부분
 *  - redirect  : 3xx — 헤더만 받고 본문은 받지 않음
 *  - not_html  : Content-Type 이 HTML/XML 이 아니라 본문을 받기 전에 끊음
 *  - encoded   : Content-Encoding 이 붙어 옴(압축 해제를 하지 않으므로 파싱 불가)
 *  - error     : 연결·TLS·타임아웃 등 전송 실패 (`status` 는 0 일 수 있음)
 */
final class LinkPreviewFetchResult
{
    public const COMPLETE = 'complete';

    public const TRUNCATED = 'truncated';

    public const REDIRECT = 'redirect';

    public const NOT_HTML = 'not_html';

    public const ENCODED = 'encoded';

    public const ERROR = 'error';

    /**
     * @param  string  $outcome  위 상수 중 하나
     * @param  int  $status  HTTP 상태 코드 (없으면 0)
     * @param  array<string, string>  $headers  소문자 헤더명 => 값 (같은 이름은 마지막 값)
     * @param  string  $body  받은 본문 (최대 `LinkPreviewFetcher::MAX_BODY_BYTES`)
     * @param  int  $errorCode  전송 실패 코드 (curl errno, 없으면 0)
     */
    public function __construct(
        public readonly string $outcome,
        public readonly int $status = 0,
        public readonly array $headers = [],
        public readonly string $body = '',
        public readonly int $errorCode = 0,
    ) {}

    public function header(string $name): ?string
    {
        return $this->headers[strtolower($name)] ?? null;
    }

    public function isRedirect(): bool
    {
        return $this->status >= 300 && $this->status < 400;
    }

    public function isSuccessful(): bool
    {
        return $this->status >= 200 && $this->status < 300;
    }
}
