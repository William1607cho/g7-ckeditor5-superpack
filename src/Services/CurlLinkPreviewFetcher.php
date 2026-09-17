<?php

namespace Plugins\G7\Ckeditor5\Superpack\Services;

use Plugins\G7\Ckeditor5\Superpack\Contracts\LinkPreviewFetcher;
use Plugins\G7\Ckeditor5\Superpack\Support\LinkPreviewFetchResult;

/**
 * curl 확장을 직접 쓰는 링크 프리뷰 수신기.
 *
 * Laravel `Http`(Guzzle)를 쓰지 않는 이유:
 *  - 크기 상한을 수신 도중에 걸려면 스트리밍이 필요한데, Guzzle 의 `stream => true` 는
 *    요청을 curl 이 아닌 StreamHandler 로 넘겨 `CURLOPT_RESOLVE` IP 고정이 무시된다
 *    (DNS rebinding 방어가 사라진다).
 *  - Guzzle 기본값은 gzip/br 을 자동으로 풀어, 작은 압축 응답이 메모리에서 부풀 수 있다.
 *
 * 동작:
 *  - `CURLOPT_RESOLVE` 로 판정을 통과한 IP 에 고정 (IPv6 는 대괄호 표기)
 *  - 환경변수 프록시 무시 (`CURLOPT_PROXY` = '')
 *  - http·https 만, 자동 리다이렉트 없음
 *  - `Accept-Encoding: identity`, 자동 압축 해제 없음. Content-Encoding 이 오면 encoded
 *  - 헤더 콜백: 3xx 는 본문 없이 끊음(redirect), HTML/XML 이 아니면 끊음(not_html)
 *  - 쓰기 콜백: 누적 {@see LinkPreviewFetcher::MAX_BODY_BYTES} 를 넘으면 끊음(truncated)
 *  - 연결 timeout 최대 3초, 전체 timeout 은 호출자가 넘긴 남은 시간
 */
class CurlLinkPreviewFetcher implements LinkPreviewFetcher
{
    /** 연결 timeout 상한 (밀리초) */
    private const CONNECT_TIMEOUT_MS = 3000;

    private const USER_AGENT = 'Mozilla/5.0 (compatible; g7-ckeditor5-superpack-linkpreview/1.0; +https://github.com/gnuboard/g7)';

    public function fetch(string $url, string $host, int $port, string $ip, float $timeoutSeconds): LinkPreviewFetchResult
    {
        $timeoutMs = max(1, (int) floor($timeoutSeconds * 1000));

        $state = [
            'status' => 0,
            'headers' => [],
            'body' => '',
            'stop' => null, // 의도적으로 끊은 이유 (LinkPreviewFetchResult 상수)
        ];

        $options = [
            CURLOPT_URL => $url,
            CURLOPT_HTTPGET => true,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            // 빈 문자열 = 프록시 사용 안 함 (http_proxy 등 환경변수 포함)
            CURLOPT_PROXY => '',
            CURLOPT_NOPROXY => '*',
            CURLOPT_CONNECTTIMEOUT_MS => min(self::CONNECT_TIMEOUT_MS, $timeoutMs),
            CURLOPT_TIMEOUT_MS => $timeoutMs,
            CURLOPT_NOSIGNAL => true,
            CURLOPT_USERAGENT => self::USER_AGENT,
            CURLOPT_HTTPHEADER => [
                'Accept: text/html,application/xhtml+xml',
                'Accept-Language: ko,en;q=0.8',
                'Accept-Encoding: identity',
            ],
            // CURLOPT_ENCODING 을 설정하지 않으므로 libcurl 은 압축을 풀지 않는다. 명시적으로도 끈다.
            CURLOPT_HTTP_CONTENT_DECODING => false,
            CURLOPT_HEADERFUNCTION => function ($ch, string $line) use (&$state): int {
                return $this->onHeader($state, $line);
            },
            CURLOPT_WRITEFUNCTION => function ($ch, string $chunk) use (&$state): int {
                return $this->onBody($state, $chunk);
            },
        ];

        // IP 리터럴 호스트는 이미 그 주소로 접속하므로 고정이 필요 없다.
        if (filter_var($host, FILTER_VALIDATE_IP) === false) {
            $address = str_contains($ip, ':') ? '['.$ip.']' : $ip;
            $options[CURLOPT_RESOLVE] = ["{$host}:{$port}:{$address}"];
        }

        $ch = curl_init();
        if ($ch === false) {
            return new LinkPreviewFetchResult(LinkPreviewFetchResult::ERROR);
        }

        if (! curl_setopt_array($ch, $options)) {
            return new LinkPreviewFetchResult(LinkPreviewFetchResult::ERROR, errorCode: curl_errno($ch));
        }

        curl_exec($ch);
        $errno = curl_errno($ch);
        unset($ch);

        if ($state['stop'] !== null) {
            return new LinkPreviewFetchResult($state['stop'], $state['status'], $state['headers'], $state['body']);
        }

        if ($errno !== 0) {
            return new LinkPreviewFetchResult(LinkPreviewFetchResult::ERROR, $state['status'], $state['headers'], '', $errno);
        }

        return new LinkPreviewFetchResult(LinkPreviewFetchResult::COMPLETE, $state['status'], $state['headers'], $state['body']);
    }

    /**
     * 헤더 한 줄 처리. 반환값이 줄 길이와 다르면 libcurl 이 수신을 중단한다.
     *
     * @param  array{status:int, headers:array<string,string>, body:string, stop:?string}  $state
     */
    private function onHeader(array &$state, string $line): int
    {
        $length = strlen($line);
        $trimmed = trim($line);

        // 상태 줄 — 100 Continue 등 중간 응답 뒤에 새 응답이 시작되면 헤더를 새로 모은다.
        if (preg_match('#^HTTP/\S+\s+(\d{3})#', $trimmed, $m) === 1) {
            $state['status'] = (int) $m[1];
            $state['headers'] = [];

            return $length;
        }

        if ($trimmed !== '') {
            $pos = strpos($trimmed, ':');
            if ($pos !== false) {
                $name = strtolower(trim(substr($trimmed, 0, $pos)));
                $state['headers'][$name] = trim(substr($trimmed, $pos + 1));
            }

            return $length;
        }

        // 빈 줄 = 헤더 끝
        $status = $state['status'];
        if ($status >= 100 && $status < 200) {
            return $length;
        }

        if ($status >= 300 && $status < 400) {
            $state['stop'] = LinkPreviewFetchResult::REDIRECT;

            return 0;
        }

        $encoding = strtolower($state['headers']['content-encoding'] ?? '');
        if ($encoding !== '' && $encoding !== 'identity') {
            $state['stop'] = LinkPreviewFetchResult::ENCODED;

            return 0;
        }

        $type = strtolower($state['headers']['content-type'] ?? '');
        if ($type !== '' && ! str_contains($type, 'html') && ! str_contains($type, 'xml')) {
            $state['stop'] = LinkPreviewFetchResult::NOT_HTML;

            return 0;
        }

        return $length;
    }

    /**
     * 본문 조각 처리. 반환값이 조각 길이와 다르면 libcurl 이 수신을 중단한다.
     *
     * @param  array{status:int, headers:array<string,string>, body:string, stop:?string}  $state
     */
    private function onBody(array &$state, string $chunk): int
    {
        $length = strlen($chunk);
        $room = self::MAX_BODY_BYTES - strlen($state['body']);

        if ($length <= $room) {
            $state['body'] .= $chunk;

            return $length;
        }

        if ($room > 0) {
            $state['body'] .= substr($chunk, 0, $room);
        }
        $state['stop'] = LinkPreviewFetchResult::TRUNCATED;

        return 0;
    }
}
