<?php

namespace Plugins\G7\Ckeditor5\Superpack\Contracts;

use Plugins\G7\Ckeditor5\Superpack\Support\LinkPreviewFetchResult;

/**
 * 링크 프리뷰용 단일 HTTP 요청(홉 1개) 수신기.
 *
 * 리다이렉트 추적·주소 판정·빈도 제한은 호출자(`LinkPreviewService`)가 맡는다.
 * 구현체는 주어진 IP 로 고정해 한 번만 요청하고, 본문 크기·형식 제한을 적용한다.
 * 테스트에서는 이 인터페이스를 컨테이너에 대체 구현으로 등록한다.
 */
interface LinkPreviewFetcher
{
    /** 본문 누적 상한 (바이트) — 넘으면 수신을 끊고 받은 부분만 돌려준다 */
    public const MAX_BODY_BYTES = 1_048_576;

    /**
     * 요청 1회를 수행한다.
     *
     * @param  string  $url  요청 URL (호스트는 `$host` 와 같아야 한다)
     * @param  string  $host  URL 의 호스트 (소문자, IPv6 는 대괄호 없이)
     * @param  int  $port  접속 포트
     * @param  string  $ip  판정을 통과한 접속 IP — 이 주소로 고정한다
     * @param  float  $timeoutSeconds  이 요청에 허용된 남은 시간 (초)
     */
    public function fetch(string $url, string $host, int $port, string $ip, float $timeoutSeconds): LinkPreviewFetchResult;
}
