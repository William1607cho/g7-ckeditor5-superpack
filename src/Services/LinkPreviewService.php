<?php

namespace Plugins\G7\Ckeditor5\Superpack\Services;

use App\Support\OutboundUrlValidator;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Plugins\G7\Ckeditor5\Superpack\Models\LinkPreview;

/**
 * 외부 링크 카드(OG 프리뷰) 취득·캐시 서비스.
 *
 * 본문의 단독 외부 링크를 방문자 화면에서 카드(대표이미지+제목+요약+도메인)로 렌더하기 위해,
 * 서버가 대신 대상 URL 의 HTML `<head>` 를 가져와 OpenGraph/기본 메타를 파싱한다.
 *
 * 브라우저가 타 도메인 HTML 을 직접 fetch 하면 CORS 로 막히므로 서버가 대행하는데,
 * 서버가 임의 URL 을 fetch 하는 것은 SSRF 표면이다. 방어:
 *  - 코어 `OutboundUrlValidator::isPublicHttpUrl()` 로 스킴·userinfo·내부망(사설/루프백/
 *    링크로컬/169.254.169.254/localhost/*.local/숫자IP 우회) 1차 차단.
 *  - **DNS rebinding 대비**: 호스트를 직접 해석(resolve)해 실제 접속할 IP 가 공개
 *    대역인지 재검증하고, 그 IP 로 핀(`CURLOPT_RESOLVE`)해 접속한다.
 *  - 자동 리다이렉트를 끄고 홉마다 위 검증을 다시 한다 (최대 4홉).
 *  - 타임아웃·본문 크기 상한.
 *
 * 캐시 TTL 은 관리자 설정으로 조정한다 (성공=일 단위 `linkcard_ttl_ok_days`,
 * 실패=시간 단위 `linkcard_ttl_fail_hours`). 성공(ok)·최소(minimal) 은 성공 TTL,
 * 빈결과(empty)·실패(failed) 는 실패 TTL 을 따른다.
 */
class LinkPreviewService
{
    /** 플러그인 식별자 (설정 조회용) */
    private const PLUGIN = 'g7-ckeditor5-superpack';

    /** 성공 캐시 TTL 기본값 (일) — 설정 미조회 시 폴백 */
    private const DEFAULT_TTL_OK_DAYS = 7;

    /** 실패 캐시 TTL 기본값 (시간) — 설정 미조회 시 폴백 */
    private const DEFAULT_TTL_FAIL_HOURS = 24;

    /** 리다이렉트 최대 추적 홉 */
    private const MAX_REDIRECTS = 4;

    /** 요청 타임아웃 (초) */
    private const TIMEOUT = 5;

    /** 파싱에 쓰는 본문 최대 바이트 (`<head>` 만 필요) */
    private const MAX_PARSE_BYTES = 300_000;

    private const USER_AGENT = 'Mozilla/5.0 (compatible; g7-ckeditor5-superpack-linkpreview/1.0; +https://github.com/gnuboard/g7)';

    /**
     * URL 의 링크 프리뷰를 반환한다 (캐시 우선).
     *
     * status: ok=풍부한 메타(OG/twitter/meta-description) / minimal=<title> 만 있음
     * (Cloudflare 챌린지 페이지 등 — 최소 카드) / empty=<title> 조차 없음 / failed=취득 실패.
     *
     * @param  string  $rawUrl  대상 URL (외부 입력)
     * @return array{status:string, title:?string, description:?string, image:?string, site_name:?string, favicon:?string, domain:?string}
     */
    public function get(string $rawUrl): array
    {
        $url = $this->normalizeUrl($rawUrl);
        $hash = hash('sha256', $url);

        $row = LinkPreview::query()->where('url_hash', $hash)->first();

        if ($row && $row->fetched_at instanceof Carbon && $row->fetched_at->gt($this->staleThreshold($row->status))) {
            return $this->present($row);
        }

        $result = $this->fetch($url);

        $row = LinkPreview::query()->updateOrCreate(
            ['url_hash' => $hash],
            [
                'url' => mb_substr($url, 0, 2048),
                'status' => $result['status'],
                'title' => $this->clip($result['title'] ?? null, 512),
                'description' => $this->clip($result['description'] ?? null, 1024),
                'image' => $this->clip($result['image'] ?? null, 2048),
                'site_name' => $this->clip($result['site_name'] ?? null, 255),
                'favicon' => $this->clip($result['favicon'] ?? null, 2048),
                'fetched_at' => now(),
            ],
        );

        return $this->present($row);
    }

    /**
     * 캐시된 status 에 따른 "이 시각보다 오래됐으면 재취득" 경계 시각.
     *
     * ok·minimal = 성공 TTL(일), empty·failed = 실패 TTL(시간).
     */
    private function staleThreshold(string $status): Carbon
    {
        if ($status === 'ok' || $status === 'minimal') {
            $days = (int) plugin_setting(self::PLUGIN, 'linkcard_ttl_ok_days', self::DEFAULT_TTL_OK_DAYS);
            $days = max(1, min(90, $days));

            return now()->subDays($days);
        }

        $hours = (int) plugin_setting(self::PLUGIN, 'linkcard_ttl_fail_hours', self::DEFAULT_TTL_FAIL_HOURS);
        $hours = max(1, min(720, $hours));

        return now()->subHours($hours);
    }

    /**
     * 캐시 행을 API 응답 형태로 변환한다.
     *
     * @return array{status:string, title:?string, description:?string, image:?string, site_name:?string, favicon:?string, domain:?string}
     */
    private function present(LinkPreview $row): array
    {
        return [
            'status' => $row->status,
            'title' => $row->title,
            'description' => $row->description,
            'image' => $row->image,
            'site_name' => $row->site_name,
            'favicon' => $row->favicon,
            'domain' => $this->hostOf($row->url),
        ];
    }

    /**
     * 대상 URL 을 실제로 가져와 메타를 파싱한다 (SSRF 방어 포함).
     *
     * @return array{status:string, title?:?string, description?:?string, image?:?string, site_name?:?string, favicon?:?string}
     */
    private function fetch(string $url): array
    {
        // 1차: 코어 SSRF 검증 (스킴/userinfo/내부 도메인/숫자IP 우회)
        if (! OutboundUrlValidator::isPublicHttpUrl($url, ['schemes' => ['http', 'https'], 'allowPort' => true])) {
            return ['status' => 'failed'];
        }

        $current = $url;
        $response = null;

        for ($hop = 0; $hop < self::MAX_REDIRECTS; $hop++) {
            $parts = parse_url($current);
            if ($parts === false || ! isset($parts['scheme'], $parts['host'])) {
                return ['status' => 'failed'];
            }

            $scheme = strtolower($parts['scheme']);
            if (! in_array($scheme, ['http', 'https'], true)) {
                return ['status' => 'failed'];
            }

            $host = strtolower($parts['host']);
            $port = $parts['port'] ?? ($scheme === 'https' ? 443 : 80);

            // 2차: 실제 접속 IP 를 직접 해석해 공개 대역인지 재검증 (DNS rebinding 대비)
            $ip = $this->resolvePublicIp($host);
            if ($ip === null) {
                return ['status' => 'failed'];
            }

            try {
                $response = Http::withHeaders([
                    'User-Agent' => self::USER_AGENT,
                    'Accept' => 'text/html,application/xhtml+xml',
                    'Accept-Language' => 'ko,en;q=0.8',
                ])
                    ->timeout(self::TIMEOUT)
                    ->connectTimeout(3)
                    ->withOptions([
                        'allow_redirects' => false,
                        'curl' => [
                            // 해석된 공개 IP 로 핀 — 검증 후 재해석(rebinding) 차단
                            CURLOPT_RESOLVE => ["{$host}:{$port}:{$ip}"],
                            CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
                            CURLOPT_REDIR_PROTOCOLS => 0,
                        ],
                    ])
                    ->get($current);
            } catch (\Throwable $e) {
                Log::info('[g7-ckeditor5-superpack] link-preview fetch 실패', ['url' => $current, 'error' => $e->getMessage()]);

                return ['status' => 'failed'];
            }

            $status = $response->status();

            if ($status >= 300 && $status < 400) {
                $location = $response->header('Location');
                if ($location === null || $location === '') {
                    return ['status' => 'failed'];
                }
                $next = $this->absolutize($location, $current);
                // 리다이렉트 목적지도 1차 검증을 다시 통과해야 함
                if (! OutboundUrlValidator::isPublicHttpUrl($next, ['schemes' => ['http', 'https'], 'allowPort' => true])) {
                    return ['status' => 'failed'];
                }
                $current = $next;

                continue;
            }

            if ($status < 200 || $status >= 300) {
                // 2xx 아님 — 주로 Cloudflare "Just a moment…" 챌린지(403). 응답 자체는
                // 받았으므로, 본문에 <title> 이라도 있으면 최소 카드로 살린다.
                return $this->parseErrorResponse($response, $current);
            }

            break; // 2xx
        }

        if ($response === null) {
            return ['status' => 'failed'];
        }
        if (! $response->successful()) {
            return $this->parseErrorResponse($response, $current);
        }

        $contentType = strtolower((string) $response->header('Content-Type'));
        if ($contentType !== '' && ! str_contains($contentType, 'html') && ! str_contains($contentType, 'xml')) {
            // HTML 이 아니면 메타가 없다
            return ['status' => 'empty'];
        }

        $html = mb_substr($response->body(), 0, self::MAX_PARSE_BYTES, 'UTF-8');

        return $this->parseMeta($html, $current);
    }

    /**
     * host 를 해석해 첫 공개 IP 를 돌려준다. IP 리터럴이면 그대로 검증.
     *
     * @return string|null 공개 대역 IP, 없으면 null
     */
    private function resolvePublicIp(string $host): ?string
    {
        $host = trim($host, '[]'); // IPv6 리터럴 대괄호 제거

        if (filter_var($host, FILTER_VALIDATE_IP) !== false) {
            return OutboundUrlValidator::isPublicHost($host) ? $host : null;
        }

        $ips = [];

        $v4 = @gethostbynamel($host);
        if (is_array($v4)) {
            $ips = array_merge($ips, $v4);
        }

        $aaaa = @dns_get_record($host, DNS_AAAA);
        if (is_array($aaaa)) {
            foreach ($aaaa as $rec) {
                if (! empty($rec['ipv6'])) {
                    $ips[] = $rec['ipv6'];
                }
            }
        }

        foreach (array_unique($ips) as $ip) {
            // 해석된 IP 중 **하나라도 내부망**이면 거부 (일부만 공개인 경우 rebinding 여지)
            if (! OutboundUrlValidator::isPublicHost($ip)) {
                return null;
            }
        }

        return $ips[0] ?? null;
    }

    /**
     * HTML `<head>` 에서 OG/기본 메타를 뽑는다.
     *
     * 상태 판정:
     *  - `ok`      : og:title/og:image/og:description/og:site_name/twitter:* 또는 meta description 중
     *                하나라도 있음 → 대표이미지 포함 완전 카드.
     *  - `minimal` : 위 "풍부한 메타"는 없지만 `<title>` 태그는 있음 → 제목 한 줄 + 도메인 +
     *                파비콘만 있는 최소 카드. Cloudflare "Just a moment…" 챌린지 페이지 등이 여기.
     *  - `empty`   : `<title>` 조차 없음 → 카드화 불가, 원본 링크 유지.
     *
     * @return array{status:string, title:?string, description:?string, image:?string, site_name:?string, favicon:?string}
     */
    private function parseMeta(string $html, string $baseUrl): array
    {
        $head = $this->headSection($html);

        $og = function (string $prop) use ($head): ?string {
            // property 와 content 순서가 바뀔 수 있어 두 패턴 모두 시도
            $p = preg_quote($prop, '/');
            if (preg_match('/<meta[^>]+(?:property|name)\s*=\s*["\']'.$p.'["\'][^>]*\bcontent\s*=\s*["\']([^"\']*)["\']/i', $head, $m)) {
                return $this->decode($m[1]);
            }
            if (preg_match('/<meta[^>]+\bcontent\s*=\s*["\']([^"\']*)["\'][^>]*(?:property|name)\s*=\s*["\']'.$p.'["\']/i', $head, $m)) {
                return $this->decode($m[1]);
            }

            return null;
        };

        $ogTitle = $og('og:title') ?? $og('twitter:title');

        $titleTag = null;
        if (preg_match('/<title[^>]*>(.*?)<\/title>/is', $head, $m)) {
            $titleTag = $this->decode(trim($m[1]));
        }

        $description = $og('og:description') ?? $og('twitter:description') ?? $og('description');
        $siteName = $og('og:site_name');

        $image = $og('og:image') ?? $og('og:image:url') ?? $og('twitter:image');
        if ($image !== null && $image !== '') {
            $image = $this->absolutize($image, $baseUrl);
            if (! OutboundUrlValidator::isStructurallySafeUrl($image, ['schemes' => ['http', 'https'], 'allowPort' => true])) {
                $image = null;
            }
        }

        $favicon = $this->parseFavicon($head, $baseUrl);

        $hasRichMeta = ($ogTitle !== null && $ogTitle !== '')
            || ($image !== null && $image !== '')
            || ($description !== null && $description !== '')
            || ($siteName !== null && $siteName !== '');

        $title = ($ogTitle !== null && $ogTitle !== '') ? $ogTitle : $titleTag;

        if ($hasRichMeta) {
            $status = 'ok';
        } elseif ($title !== null && $title !== '') {
            $status = 'minimal';
        } else {
            $status = 'empty';
        }

        return [
            'status' => $status,
            'title' => $title ?: null,
            'description' => $description ?: null,
            'image' => $image ?: null,
            'site_name' => $siteName ?: null,
            'favicon' => $favicon ?: null,
        ];
    }

    /**
     * `<head>` 에서 파비콘 URL 을 뽑는다. 명시된 `<link rel="...icon...">` 이 없으면
     * 오리진의 `/favicon.ico` 를 폴백으로 쓴다. 구조적으로 안전한 http(s) URL 만 반환.
     */
    private function parseFavicon(string $head, string $baseUrl): ?string
    {
        $candidates = [];

        if (preg_match_all('/<link\b[^>]*>/i', $head, $tags)) {
            foreach ($tags[0] as $tag) {
                if (! preg_match('/\brel\s*=\s*["\']([^"\']+)["\']/i', $tag, $rm)) {
                    continue;
                }
                if (! str_contains(strtolower($rm[1]), 'icon')) {
                    continue;
                }
                if (! preg_match('/\bhref\s*=\s*["\']([^"\']+)["\']/i', $tag, $hm)) {
                    continue;
                }
                $candidates[] = $this->absolutize(trim($this->decode($hm[1])), $baseUrl);
            }
        }

        $b = parse_url($baseUrl);
        if (isset($b['scheme'], $b['host'])) {
            $candidates[] = $b['scheme'].'://'.$b['host'].(isset($b['port']) ? ':'.$b['port'] : '').'/favicon.ico';
        }

        foreach ($candidates as $c) {
            if ($c !== '' && OutboundUrlValidator::isStructurallySafeUrl($c, ['schemes' => ['http', 'https'], 'allowPort' => true])) {
                return $c;
            }
        }

        return null;
    }

    /**
     * 2xx 가 아닌 응답(주로 403 봇 챌린지)에서 최소 정보만 건진다.
     *
     * 응답 본문에 유효한 `<title>` 이 있으면 `minimal`(제목 + 파비콘) — 에러 응답이므로
     * og:image·요약은 신뢰하지 않는다. `<title>` 이 없거나 HTML 이 아니면 `failed`.
     *
     * @return array{status:string, title?:?string, favicon?:?string}
     */
    private function parseErrorResponse(\Illuminate\Http\Client\Response $response, string $currentUrl): array
    {
        $contentType = strtolower((string) $response->header('Content-Type'));
        if ($contentType !== '' && ! str_contains($contentType, 'html') && ! str_contains($contentType, 'xml')) {
            return ['status' => 'failed'];
        }

        $html = mb_substr($response->body(), 0, self::MAX_PARSE_BYTES, 'UTF-8');
        $head = $this->headSection($html);

        if (! preg_match('/<title[^>]*>(.*?)<\/title>/is', $head, $m)) {
            return ['status' => 'failed'];
        }

        $title = $this->decode(trim($m[1]));
        if ($title === '') {
            return ['status' => 'failed'];
        }

        return [
            'status' => 'minimal',
            'title' => $title,
            'favicon' => $this->parseFavicon($head, $currentUrl),
        ];
    }

    /** `<head>` 구간만 잘라 파싱 비용을 줄인다 (없으면 앞부분 사용) */
    private function headSection(string $html): string
    {
        if (preg_match('/<head\b[^>]*>(.*?)<\/head>/is', $html, $m)) {
            return $m[1];
        }

        return mb_substr($html, 0, 100_000, 'UTF-8');
    }

    /** 상대 URL 을 base 기준 절대 URL 로 */
    private function absolutize(string $url, string $base): string
    {
        $url = trim($url);
        if ($url === '' || preg_match('#^https?://#i', $url)) {
            return $url;
        }
        if (str_starts_with($url, '//')) {
            $scheme = parse_url($base, PHP_URL_SCHEME) ?: 'https';

            return $scheme.':'.$url;
        }

        $b = parse_url($base);
        if (! isset($b['scheme'], $b['host'])) {
            return $url;
        }
        $origin = $b['scheme'].'://'.$b['host'].(isset($b['port']) ? ':'.$b['port'] : '');

        if (str_starts_with($url, '/')) {
            return $origin.$url;
        }

        $path = $b['path'] ?? '/';
        $dir = substr($path, 0, strrpos($path, '/') + 1) ?: '/';

        return $origin.$dir.$url;
    }

    /** 저장/조회 키 정규화 — 프래그먼트 제거, 트림 */
    private function normalizeUrl(string $url): string
    {
        $url = trim($url);
        $url = preg_replace('/#.*$/', '', $url) ?? $url;

        return $url;
    }

    private function hostOf(string $url): ?string
    {
        $h = parse_url($url, PHP_URL_HOST);

        return is_string($h) ? preg_replace('/^www\./i', '', strtolower($h)) : null;
    }

    private function decode(string $s): string
    {
        return trim(html_entity_decode($s, ENT_QUOTES | ENT_HTML5, 'UTF-8'));
    }

    private function clip(?string $s, int $max): ?string
    {
        if ($s === null || $s === '') {
            return null;
        }

        return mb_substr($s, 0, $max, 'UTF-8');
    }
}
