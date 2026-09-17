<?php

namespace Plugins\G7\Ckeditor5\Superpack\Tests\Support;

use Plugins\G7\Ckeditor5\Superpack\Contracts\LinkPreviewFetcher;
use Plugins\G7\Ckeditor5\Superpack\Support\LinkPreviewFetchResult;

/**
 * 테스트용 수신기 — 네트워크를 쓰지 않고 준비된 결과를 순서대로 돌려준다.
 * 준비된 결과보다 많이 호출되면 예외를 던져 "요청하면 안 되는 경우"를 잡는다.
 */
final class FakeLinkPreviewFetcher implements LinkPreviewFetcher
{
    /** @var array<int, array{url:string, host:string, port:int, ip:string, timeout:float}> */
    public array $calls = [];

    /** @var array<int, LinkPreviewFetchResult|\Closure(): LinkPreviewFetchResult> */
    private array $queue = [];

    /**
     * @param  LinkPreviewFetchResult|\Closure(): LinkPreviewFetchResult  ...$results  클로저는 호출 시점에 실행된다
     */
    public function push(LinkPreviewFetchResult|\Closure ...$results): self
    {
        foreach ($results as $result) {
            $this->queue[] = $result;
        }

        return $this;
    }

    public function fetch(string $url, string $host, int $port, string $ip, float $timeoutSeconds): LinkPreviewFetchResult
    {
        $this->calls[] = ['url' => $url, 'host' => $host, 'port' => $port, 'ip' => $ip, 'timeout' => $timeoutSeconds];

        if ($this->queue === []) {
            throw new \RuntimeException('예상하지 않은 외부 요청: '.$url);
        }

        $next = array_shift($this->queue);

        return $next instanceof \Closure ? $next() : $next;
    }

    public static function html(string $body, int $status = 200, string $contentType = 'text/html; charset=utf-8', string $outcome = LinkPreviewFetchResult::COMPLETE): LinkPreviewFetchResult
    {
        return new LinkPreviewFetchResult($outcome, $status, ['content-type' => $contentType], $body);
    }

    public static function redirect(string $location, int $status = 302): LinkPreviewFetchResult
    {
        return new LinkPreviewFetchResult(LinkPreviewFetchResult::REDIRECT, $status, ['location' => $location]);
    }

    public static function notHtml(int $status = 200, string $contentType = 'image/png'): LinkPreviewFetchResult
    {
        return new LinkPreviewFetchResult(LinkPreviewFetchResult::NOT_HTML, $status, ['content-type' => $contentType]);
    }

    public static function encoded(): LinkPreviewFetchResult
    {
        return new LinkPreviewFetchResult(LinkPreviewFetchResult::ENCODED, 200, ['content-type' => 'text/html', 'content-encoding' => 'gzip']);
    }

    public static function error(int $code = 28): LinkPreviewFetchResult
    {
        return new LinkPreviewFetchResult(LinkPreviewFetchResult::ERROR, 0, [], '', $code);
    }

    public static function ogPage(string $title = 'OG 제목', string $extraHead = ''): string
    {
        return '<!doctype html><html><head><title>태그 제목</title>'
            .'<meta property="og:title" content="'.$title.'">'
            .'<meta property="og:description" content="요약">'
            .'<meta property="og:image" content="/img.png">'
            .$extraHead
            .'</head><body>본문</body></html>';
    }
}
