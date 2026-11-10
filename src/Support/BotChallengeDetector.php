<?php

namespace Plugins\G7\Ckeditor5\Superpack\Support;

/**
 * 봇 차단 챌린지 페이지 판별 순수 클래스 (1.7.0).
 *
 * Cloudflare "Just a moment…" 같은 페이지는 진짜 글 제목이 아니므로 카드로 만들지 않고
 * 캐시에도 남기지 않는다(1.6.x 는 이 제목으로 최소 카드를 만들어 성공 TTL 동안 보관했다).
 *
 * 판정:
 *  - 응답 헤더 `cf-mitigated: challenge` 가 있으면 상태 코드와 무관하게 챌린지
 *  - 상태가 403·429·503 이고 `<title>` 또는 본문 앞부분에 알려진 표식이 있으면 챌린지
 *  - 2xx 는 제목이 정확히 알려진 챌린지 제목일 때만 챌린지(오탐 방지 — 표식 단어가 든 정상 글이 있다)
 */
final class BotChallengeDetector
{
    /** 이 상태 코드에서만 본문 표식을 본다 */
    public const CHALLENGE_STATUSES = [403, 429, 503];

    /** 제목 표식 (소문자, 부분 일치) — 오류 응답에서만 쓴다 */
    public const TITLE_MARKERS = [
        'just a moment',
        'attention required',
        'please wait',
        'checking your browser',
        'ddos-guard',
        'access denied',
        'security check',
        'verifying you are human',
        'are you a robot',
        'captcha',
    ];

    /** 본문 표식 (소문자, 부분 일치) — 오류 응답에서만 쓴다 */
    public const BODY_MARKERS = [
        'challenge-platform',
        '_cf_chl_opt',
        'cf-browser-verification',
        'cf_chl_',
        'ddos-guard',
        'g-recaptcha',
        'hcaptcha',
        'perimeterx',
        '_incapsula_resource',
    ];

    /** 2xx 에서도 챌린지로 보는 제목 (소문자, 앞뒤 공백·말줄임 제거 후 정확히 일치) */
    public const EXACT_TITLES = [
        'just a moment',
        'attention required! | cloudflare',
        'ddos-guard',
    ];

    /** 본문 표식을 찾는 앞부분 바이트 */
    private const BODY_SCAN_BYTES = 65536;

    /**
     * @param  int  $status  HTTP 상태 코드
     * @param  array<string, string>  $headers  소문자 헤더명 => 값
     * @param  string  $body  응답 본문(앞부분이면 충분)
     */
    public static function isChallenge(int $status, array $headers, string $body): bool
    {
        $mitigated = strtolower(trim((string) ($headers['cf-mitigated'] ?? '')));
        if ($mitigated === 'challenge') {
            return true;
        }

        $title = self::title($body);

        if ($status >= 200 && $status < 300) {
            if ($title === null) {
                return false;
            }
            $normalized = rtrim($title, " .…\t\n\r");

            return in_array($normalized, self::EXACT_TITLES, true);
        }

        if (! in_array($status, self::CHALLENGE_STATUSES, true)) {
            return false;
        }

        if ($title !== null) {
            foreach (self::TITLE_MARKERS as $marker) {
                if (str_contains($title, $marker)) {
                    return true;
                }
            }
        }

        $scan = strtolower(substr($body, 0, self::BODY_SCAN_BYTES));
        foreach (self::BODY_MARKERS as $marker) {
            if (str_contains($scan, $marker)) {
                return true;
            }
        }

        return false;
    }

    /** `<title>` 내용(소문자, 엔티티 풀고 공백 정리) 또는 null */
    private static function title(string $body): ?string
    {
        if (preg_match('/<title[^>]*>(.*?)<\/title>/is', substr($body, 0, self::BODY_SCAN_BYTES), $m) !== 1) {
            return null;
        }

        $t = html_entity_decode($m[1], ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $t = strtolower(trim((string) preg_replace('/\s+/', ' ', $t)));

        return $t === '' ? null : $t;
    }
}
