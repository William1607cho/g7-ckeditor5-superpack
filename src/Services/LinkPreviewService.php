<?php

namespace Plugins\G7\Ckeditor5\Superpack\Services;

use App\Support\OutboundUrlValidator;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\RateLimiter;
use Plugins\G7\Ckeditor5\Superpack\Contracts\LinkPreviewFetcher;
use Plugins\G7\Ckeditor5\Superpack\Models\LinkPreview;
use Plugins\G7\Ckeditor5\Superpack\Support\LinkPreviewFetchResult;
use Plugins\G7\Ckeditor5\Superpack\Support\OutboundIpGuard;

/**
 * 외부 링크 카드(OG 프리뷰) 취득·캐시 서비스.
 *
 * 본문의 단독 외부 링크를 방문자 화면에서 카드(대표이미지+제목+요약+도메인)로 렌더하기 위해,
 * 서버가 대신 대상 URL 의 HTML `<head>` 를 가져와 OpenGraph/기본 메타를 파싱한다.
 *
 * 브라우저가 타 도메인 HTML 을 직접 fetch 하면 CORS 로 막히므로 서버가 대행하는데,
 * 서버가 임의 URL 을 fetch 하는 것은 SSRF 표면이다. 방어 (v1.4.0):
 *  - 코어 `OutboundUrlValidator::isPublicHttpUrl()` 로 스킴·userinfo·내부 도메인 1차 차단.
 *  - 호스트가 IP 리터럴(숫자형 IPv4 표기 포함)이면 코어 판정과 무관하게
 *    {@see OutboundIpGuard} 로 다시 판정한다.
 *  - 도메인 이름은 직접 해석해 **모든** 해석 IP 가 {@see OutboundIpGuard} 를 통과해야 하고,
 *    그 IP 로 고정(`CURLOPT_RESOLVE`)해 접속한다 (DNS rebinding 대비).
 *  - 자동 리다이렉트를 끄고 홉마다 위 검증을 다시 한다 (요청 최대 4회).
 *  - 수신은 {@see LinkPreviewFetcher} 가 맡는다: 본문 1 MiB 상한·비HTML 조기 중단·
 *    압축 거부·프록시 무시. 모든 홉을 합친 마감 8초.
 *  - 실제 외부 요청에만 빈도 제한: 서버 전체 분당 120회, 대상 호스트당 분당 20회.
 *    초과하면 failed 를 돌려주고 캐시에 기록하지 않는다.
 *
 * 캐시 TTL 은 관리자 설정으로 조정한다 (성공=일 단위 `linkcard_ttl_ok_days`,
 * 실패=시간 단위 `linkcard_ttl_fail_hours`). 성공(ok)·최소(minimal) 은 성공 TTL,
 * 빈결과(empty)·실패(failed) 는 실패 TTL 을 따른다. TTL 이 지난 행과 상한
 * {@see self::MAX_ROWS} 초과분은 `prune-link-previews` 명령이 지운다.
 */
class LinkPreviewService
{
    /** 플러그인 식별자 (설정 조회용) */
    private const PLUGIN = 'g7-ckeditor5-superpack';

    /** 성공 캐시 TTL 기본값 (일) — 설정 미조회 시 폴백 */
    private const DEFAULT_TTL_OK_DAYS = 7;

    /** 실패 캐시 TTL 기본값 (시간) — 설정 미조회 시 폴백 */
    private const DEFAULT_TTL_FAIL_HOURS = 24;

    /** 한 링크에 보내는 요청 최대 횟수 (최초 1 + 리다이렉트 3) */
    private const MAX_HOPS = 4;

    /** 모든 홉을 합친 마감 (초) */
    private const TOTAL_DEADLINE_SECONDS = 8.0;

    /** 남은 시간이 이보다 짧으면 다음 홉을 시작하지 않는다 (초) */
    private const MIN_HOP_SECONDS = 0.2;

    /** 파싱에 쓰는 본문 최대 바이트 — 수신 상한과 같다 */
    private const MAX_PARSE_BYTES = LinkPreviewFetcher::MAX_BODY_BYTES;

    /** `<head>` 가 없을 때 파싱할 앞부분 바이트 */
    private const HEADLESS_PARSE_BYTES = 100_000;

    /** 실제 외부 요청 빈도 상한 — 서버 전체 (분당) */
    public const LIMIT_GLOBAL_PER_MINUTE = 120;

    /** 실제 외부 요청 빈도 상한 — 대상 호스트당 (분당) */
    public const LIMIT_HOST_PER_MINUTE = 20;

    /** RateLimiter 키 접두사 */
    public const LIMIT_KEY_PREFIX = 'g7-ckeditor5-superpack:link-preview';

    /** 캐시 테이블 최대 행 수 — 초과분은 오래된 행부터 정리 */
    public const MAX_ROWS = 50_000;

    /** 정리 시 한 번에 지우는 행 수 */
    private const PRUNE_CHUNK = 1000;

    /** 성공 계열 상태 */
    private const OK_STATUSES = ['ok', 'minimal'];

    private readonly LinkPreviewFetcher $fetcher;

    public function __construct(?LinkPreviewFetcher $fetcher = null)
    {
        $this->fetcher = $fetcher ?? new CurlLinkPreviewFetcher;
    }

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

        if (! empty($result['rate_limited'])) {
            // 빈도 제한으로 요청하지 못했다 — 실패를 캐시하면 제한이 풀린 뒤에도
            // 실패 TTL 동안 카드가 안 나오므로 기록하지 않는다.
            return $this->presentFailed($url);
        }

        $row = $this->store($hash, [
            'url' => mb_substr($url, 0, 2048),
            'status' => $result['status'],
            'title' => $this->clip($result['title'] ?? null, 512),
            'description' => $this->clip($result['description'] ?? null, 1024),
            'image' => $this->urlOrNull($result['image'] ?? null, 2048),
            'site_name' => $this->clip($result['site_name'] ?? null, 255),
            'favicon' => $this->urlOrNull($result['favicon'] ?? null, 2048),
            'fetched_at' => now(),
        ]);

        return $this->present($row);
    }

    /**
     * TTL 이 지난 행과 상한 초과분을 지운다.
     *
     * @param  bool  $dryRun  true 면 지우지 않고 대상 건수만 센다
     * @param  int|null  $maxRows  최대 행 수 (null = {@see self::MAX_ROWS}, 테스트용 인자)
     * @return array{expired:int, overflow:int, remaining:int}
     */
    public function prune(bool $dryRun = false, ?int $maxRows = null): array
    {
        $maxRows = max(0, $maxRows ?? self::MAX_ROWS);
        $okBefore = $this->staleThreshold('ok');
        $failBefore = $this->staleThreshold('failed');

        $expiredQuery = fn () => LinkPreview::query()->where(function ($q) use ($okBefore, $failBefore) {
            $q->where(function ($w) use ($okBefore) {
                $w->whereIn('status', self::OK_STATUSES)->where('fetched_at', '<', $okBefore);
            })->orWhere(function ($w) use ($failBefore) {
                $w->whereNotIn('status', self::OK_STATUSES)->where('fetched_at', '<', $failBefore);
            });
        });

        $total = LinkPreview::query()->count();

        if ($dryRun) {
            $expired = $expiredQuery()->count();
            $overflow = max(0, $total - $expired - $maxRows);

            return ['expired' => $expired, 'overflow' => $overflow, 'remaining' => $total - $expired - $overflow];
        }

        $expired = 0;
        while (true) {
            $ids = $expiredQuery()->orderBy('fetched_at')->orderBy('id')->limit(self::PRUNE_CHUNK)->pluck('id');
            if ($ids->isEmpty()) {
                break;
            }
            $deleted = LinkPreview::query()->whereIn('id', $ids)->delete();
            if ($deleted === 0) {
                break;
            }
            $expired += $deleted;
        }

        $overflow = 0;
        $excess = LinkPreview::query()->count() - $maxRows;
        while ($excess > 0) {
            $ids = LinkPreview::query()->orderBy('fetched_at')->orderBy('id')
                ->limit(min(self::PRUNE_CHUNK, $excess))->pluck('id');
            if ($ids->isEmpty()) {
                break;
            }
            $deleted = LinkPreview::query()->whereIn('id', $ids)->delete();
            if ($deleted === 0) {
                break;
            }
            $overflow += $deleted;
            $excess -= $deleted;
        }

        return ['expired' => $expired, 'overflow' => $overflow, 'remaining' => LinkPreview::query()->count()];
    }

    /**
     * 캐시된 status 에 따른 "이 시각보다 오래됐으면 재취득" 경계 시각.
     *
     * ok·minimal = 성공 TTL(일), 그 밖 = 실패 TTL(시간).
     */
    public function staleThreshold(string $status): Carbon
    {
        if (in_array($status, self::OK_STATUSES, true)) {
            $days = $this->settingInt('linkcard_ttl_ok_days', self::DEFAULT_TTL_OK_DAYS);
            $days = max(1, min(90, $days));

            return now()->subDays($days);
        }

        $hours = $this->settingInt('linkcard_ttl_fail_hours', self::DEFAULT_TTL_FAIL_HOURS);
        $hours = max(1, min(720, $hours));

        return now()->subHours($hours);
    }

    /**
     * 플러그인 정수 설정 — 조회에 실패하면 기본값.
     */
    private function settingInt(string $key, int $default): int
    {
        try {
            return (int) plugin_setting(self::PLUGIN, $key, $default);
        } catch (\Throwable) {
            return $default;
        }
    }

    /**
     * 행을 저장한다. 동시 요청이 같은 URL 의 첫 행을 먼저 만들었으면 그 행을 돌려준다.
     *
     * @param  array<string, mixed>  $attributes
     */
    private function store(string $hash, array $attributes): LinkPreview
    {
        try {
            return LinkPreview::query()->updateOrCreate(['url_hash' => $hash], $attributes);
        } catch (UniqueConstraintViolationException $e) {
            $row = LinkPreview::query()->where('url_hash', $hash)->first();
            if ($row === null) {
                throw $e;
            }

            return $row;
        }
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
     * 저장하지 않은 실패 응답.
     *
     * @return array{status:string, title:null, description:null, image:null, site_name:null, favicon:null, domain:?string}
     */
    private function presentFailed(string $url): array
    {
        return [
            'status' => 'failed',
            'title' => null,
            'description' => null,
            'image' => null,
            'site_name' => null,
            'favicon' => null,
            'domain' => $this->hostOf($url),
        ];
    }

    /**
     * 대상 URL 을 실제로 가져와 메타를 파싱한다 (SSRF 방어 포함).
     *
     * @return array{status:string, rate_limited?:bool, title?:?string, description?:?string, image?:?string, site_name?:?string, favicon?:?string}
     */
    private function fetch(string $url): array
    {
        if (! $this->isFetchableUrl($url)) {
            return ['status' => 'failed'];
        }

        $deadline = microtime(true) + self::TOTAL_DEADLINE_SECONDS;
        $current = $url;

        for ($hop = 0; $hop < self::MAX_HOPS; $hop++) {
            $target = $this->resolveTarget($current);
            if ($target === null) {
                return ['status' => 'failed'];
            }

            $remaining = $deadline - microtime(true);
            if ($remaining < self::MIN_HOP_SECONDS) {
                return ['status' => 'failed'];
            }

            if (! $this->acquireFetchSlot($target['host'])) {
                return ['status' => 'failed', 'rate_limited' => true];
            }

            $response = $this->fetcher->fetch($target['url'], $target['host'], $target['port'], $target['ip'], $remaining);

            if ($response->outcome === LinkPreviewFetchResult::ERROR) {
                Log::info('[g7-ckeditor5-superpack] link-preview fetch 실패', [
                    'host' => $target['host'],
                    'code' => $response->errorCode,
                ]);

                return ['status' => 'failed'];
            }

            if ($response->outcome === LinkPreviewFetchResult::ENCODED) {
                return ['status' => 'failed'];
            }

            if ($response->isRedirect()) {
                // 한도를 채운 뒤의 3xx 는 따라가지 않고 실패로 본다.
                if ($hop + 1 >= self::MAX_HOPS) {
                    return ['status' => 'failed'];
                }

                $location = $response->header('Location');
                if ($location === null || trim($location) === '') {
                    return ['status' => 'failed'];
                }

                $next = $this->absolutize($location, $target['url']);
                if (! $this->isFetchableUrl($next)) {
                    return ['status' => 'failed'];
                }
                $current = $next;

                continue;
            }

            if ($response->outcome === LinkPreviewFetchResult::NOT_HTML) {
                // HTML 이 아니면 메타가 없다 (에러 응답이면 실패).
                return ['status' => $response->isSuccessful() ? 'empty' : 'failed'];
            }

            if (! $response->isSuccessful()) {
                // 2xx 아님 — 주로 Cloudflare "Just a moment…" 챌린지(403). 응답 자체는
                // 받았으므로, 본문에 <title> 이라도 있으면 최소 카드로 살린다.
                return $this->parseErrorResponse($response->body, $target['url']);
            }

            return $this->parseMeta($response->body, $target['url']);
        }

        return ['status' => 'failed'];
    }

    /**
     * 요청해도 되는 URL 인지 1차 판정한다 (코어 판정 + IP 리터럴 재판정).
     */
    private function isFetchableUrl(string $url): bool
    {
        if (! OutboundUrlValidator::isPublicHttpUrl($url, ['schemes' => ['http', 'https'], 'allowPort' => true])) {
            return false;
        }

        $host = parse_url($url, PHP_URL_HOST);
        if (! is_string($host) || $host === '') {
            return false;
        }

        $kind = OutboundIpGuard::classifyHost($host);

        return match ($kind['kind']) {
            'ip' => OutboundIpGuard::isPublicIp($kind['ip']),
            'name' => true,
            default => false,
        };
    }

    /**
     * 요청 대상(접속 URL·호스트·포트·고정 IP)을 정한다.
     *
     * 도메인 이름은 IDNA 정규화(ASCII)한 이름으로 URL 을 다시 쓰고 그 이름으로 해석·고정한다.
     * 연결 계층이 쓰는 이름과 고정 항목의 이름이 어긋나면 libcurl 이 직접 해석해 고정이
     * 무력화되기 때문이다. 숫자형 IPv4 표기도 점 네 개 표기로 다시 쓴다.
     *
     * @return array{url:string, host:string, port:int, ip:string}|null 요청하면 안 되면 null
     */
    private function resolveTarget(string $url): ?array
    {
        $parts = parse_url($url);
        if ($parts === false || ! isset($parts['scheme'], $parts['host'])) {
            return null;
        }

        $scheme = strtolower($parts['scheme']);
        if (! in_array($scheme, ['http', 'https'], true)) {
            return null;
        }

        $rawHost = strtolower($parts['host']);
        $port = (int) ($parts['port'] ?? ($scheme === 'https' ? 443 : 80));

        $kind = OutboundIpGuard::classifyHost($rawHost);

        if ($kind['kind'] === 'ip') {
            if (! OutboundIpGuard::isPublicIp($kind['ip'])) {
                return null;
            }
            $ip = $kind['ip'];
            $urlHost = str_contains($ip, ':') ? '['.$ip.']' : $ip;

            return [
                'url' => $this->withHost($url, $urlHost),
                'host' => $ip,
                'port' => $port,
                'ip' => $ip,
            ];
        }

        if ($kind['kind'] !== 'name') {
            return null;
        }

        $host = OutboundUrlValidator::normalizeHost($rawHost);
        if ($host === null || $host === '') {
            return null;
        }

        $ip = $this->resolvePublicIp($host);
        if ($ip === null) {
            return null;
        }

        return [
            'url' => $host === $rawHost ? $url : $this->withHost($url, $host),
            'host' => $host,
            'port' => $port,
            'ip' => $ip,
        ];
    }

    /**
     * URL 의 호스트 부분만 바꾼다 (userinfo 는 1차 판정에서 이미 거부된다).
     */
    private function withHost(string $url, string $host): string
    {
        return (string) preg_replace_callback(
            '#^([a-z][a-z0-9+.\-]*://)(\[[^\]]*\]|[^/?\#:]*)#i',
            fn (array $m) => $m[1].$host,
            $url,
            1,
        );
    }

    /**
     * 도메인 이름을 해석해 첫 IP 를 돌려준다. 해석된 IP 가 **하나라도** 내부 주소면 거부한다
     * (일부만 공개인 경우 rebinding 여지).
     *
     * @return string|null 공개 대역 IP, 없으면 null
     */
    private function resolvePublicIp(string $host): ?string
    {
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

        $ips = array_values(array_unique($ips));

        foreach ($ips as $ip) {
            if (! OutboundIpGuard::isPublicIp($ip)) {
                return null;
            }
        }

        return $ips[0] ?? null;
    }

    /**
     * 실제 외부 요청 1회분의 빈도 한도를 확보한다.
     */
    private function acquireFetchSlot(string $host): bool
    {
        $globalKey = self::LIMIT_KEY_PREFIX.':global';
        $hostKey = self::LIMIT_KEY_PREFIX.':host:'.hash('sha256', $host);

        if (RateLimiter::tooManyAttempts($globalKey, self::LIMIT_GLOBAL_PER_MINUTE)
            || RateLimiter::tooManyAttempts($hostKey, self::LIMIT_HOST_PER_MINUTE)) {
            return false;
        }

        RateLimiter::hit($globalKey, 60);
        RateLimiter::hit($hostKey, 60);

        return true;
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
    private function parseMeta(string $body, string $baseUrl): array
    {
        $head = $this->headSection(substr($body, 0, self::MAX_PARSE_BYTES));

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
     * og:image·요약은 신뢰하지 않는다. `<title>` 이 없으면 `failed`.
     *
     * @return array{status:string, title?:?string, favicon?:?string}
     */
    private function parseErrorResponse(string $body, string $currentUrl): array
    {
        $head = $this->headSection(substr($body, 0, self::MAX_PARSE_BYTES));

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

        return substr($html, 0, self::HEADLESS_PARSE_BYTES);
    }

    /** 상대 URL 을 base 기준 절대 URL 로 */
    private function absolutize(string $url, string $base): string
    {
        $url = trim($url);
        // 스킴이 있으면(`ftp:`, `javascript:` 포함) 그대로 둔다 — 상대 경로로 붙이지 않고
        // 호출부의 판정에서 거부되게 한다.
        if ($url === '' || preg_match('#^[a-z][a-z0-9+.\-]*:#i', $url)) {
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

    /**
     * HTML 엔티티를 풀고, 잘린 본문·비UTF-8 페이지의 깨진 바이트를 치환한다
     * (DB 저장 시 잘못된 UTF-8 로 오류가 나지 않도록).
     */
    private function decode(string $s): string
    {
        $s = mb_scrub($s, 'UTF-8');

        return trim(html_entity_decode($s, ENT_QUOTES | ENT_HTML5 | ENT_SUBSTITUTE, 'UTF-8'));
    }

    private function clip(?string $s, int $max): ?string
    {
        if ($s === null || $s === '') {
            return null;
        }

        return mb_substr(mb_scrub($s, 'UTF-8'), 0, $max, 'UTF-8');
    }

    /**
     * URL 은 자르면 깨진 주소가 되므로, 길이 상한을 넘으면 버린다.
     */
    private function urlOrNull(?string $s, int $max): ?string
    {
        if ($s === null || $s === '') {
            return null;
        }

        return mb_strlen($s, 'UTF-8') > $max ? null : $s;
    }
}
