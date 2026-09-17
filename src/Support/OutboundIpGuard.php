<?php

namespace Plugins\G7\Ckeditor5\Superpack\Support;

/**
 * 링크 프리뷰가 접속할 IP 가 공개 인터넷 주소인지 판정한다.
 *
 * 코어 `OutboundUrlValidator::isPublicHost()` 는 `FILTER_FLAG_NO_PRIV_RANGE |
 * FILTER_FLAG_NO_RES_RANGE` 만 보므로 PHP 8.2 에서 다음을 공개 주소로 통과시킨다(실측):
 * CGNAT 100.64.0.0/10(Tailscale 대역), 198.18.0.0/15, 192.0.0.0/24, IPv4-mapped
 * `::ffff:127.0.0.1`. 이 클래스는 코어 판정과 무관하게 아래를 모두 적용한다.
 *
 *  - `FILTER_FLAG_GLOBAL_RANGE` (PHP 8.2+)
 *  - 플러그인 자체 차단 대역 {@see self::BLOCKED_CIDRS}
 *  - IPv4-mapped(`::ffff:0:0/96`)·IPv4-compatible(`::/96`) 주소는 내장 IPv4 를 꺼내 다시 판정
 *  - URL 호스트에 쓰인 10진수·8진수·16진수 IPv4 표기(`2130706433`, `0177.0.0.1`,
 *    `0x7f.1`)는 inet_aton 규칙으로 해석한 IP 로 판정 — libc·libcurl 이 같은 규칙으로
 *    접속하기 때문이다.
 */
final class OutboundIpGuard
{
    /** 전역 대역 플래그 외에 추가로 막는 대역 */
    public const BLOCKED_CIDRS = [
        '100.64.0.0/10',   // CGNAT (Tailscale 등)
        '198.18.0.0/15',   // 벤치마크
        '192.0.0.0/24',    // IETF 프로토콜 할당
        '0.0.0.0/8',       // "이 네트워크"
        'fc00::/7',        // IPv6 ULA (Tailscale fd7a:115c:a1e0::/48 포함)
        'fe80::/10',       // IPv6 링크로컬
        '64:ff9b::/96',    // NAT64 — 내장 IPv4 로 변환되어 나간다
        '2002::/16',       // 6to4 — 내장 IPv4 로 변환되어 나간다
    ];

    /**
     * IP 문자열이 공개 인터넷 주소인지 판정한다.
     *
     * @param  string  $ip  IPv4/IPv6 리터럴 (IPv6 는 대괄호가 있어도 된다)
     * @return bool 공개 주소이면 true, 판정 불가·내부 주소이면 false
     */
    public static function isPublicIp(string $ip): bool
    {
        $ip = trim($ip);
        if (str_starts_with($ip, '[') && str_ends_with($ip, ']')) {
            $ip = substr($ip, 1, -1);
        }

        if (filter_var($ip, FILTER_VALIDATE_IP) === false) {
            return false;
        }

        $bin = @inet_pton($ip);
        if ($bin === false) {
            return false;
        }

        if (strlen($bin) === 16) {
            $embedded = self::embeddedIpv4($bin);
            if ($embedded !== null) {
                return self::isPublicIp($embedded);
            }
        }

        if (filter_var($ip, FILTER_VALIDATE_IP, self::globalFlags()) === false) {
            return false;
        }

        foreach (self::BLOCKED_CIDRS as $cidr) {
            if (self::inCidr($bin, $cidr)) {
                return false;
            }
        }

        return true;
    }

    /**
     * URL 호스트가 IP 리터럴인지 분류한다.
     *
     * @param  string  $host  URL 호스트 (소문자, IPv6 는 대괄호가 있어도 된다)
     * @return array{kind: 'ip', ip: string}|array{kind: 'name'}|array{kind: 'invalid'}
     *                                                                                   ip=IP 리터럴(정규화된 표기), name=도메인 이름, invalid=숫자형 IPv4 처럼 보이지만 해석할 수 없음
     */
    public static function classifyHost(string $host): array
    {
        $host = strtolower(trim($host));
        if (str_starts_with($host, '[') && str_ends_with($host, ']')) {
            $host = substr($host, 1, -1);
        }

        if (filter_var($host, FILTER_VALIDATE_IP) !== false) {
            return ['kind' => 'ip', 'ip' => $host];
        }

        $legacy = self::parseLegacyIpv4($host);
        if ($legacy === false) {
            return ['kind' => 'invalid'];
        }
        if ($legacy !== null) {
            return ['kind' => 'ip', 'ip' => $legacy];
        }

        return ['kind' => 'name'];
    }

    /**
     * inet_aton 규칙의 숫자형 IPv4 표기를 점 네 개 표기로 바꾼다.
     *
     * 1~4 개 부분, 각 부분은 10진수·8진수(0 시작)·16진수(0x 시작). 마지막 부분이 남은
     * 바이트를 모두 채운다(`127.1` = 127.0.0.1, `2130706433` = 127.0.0.1).
     *
     * @return string|false|null 해석한 IPv4, 숫자형이 아니면 null, 숫자형인데 해석 불가면 false
     */
    public static function parseLegacyIpv4(string $host): string|false|null
    {
        $host = rtrim($host, '.');
        if (preg_match('/^(0x[0-9a-f]*|[0-9]+)(\.(0x[0-9a-f]*|[0-9]+)){0,3}$/i', $host) !== 1) {
            return null;
        }

        $parts = explode('.', $host);
        $values = [];
        foreach ($parts as $part) {
            $lower = strtolower($part);
            if (str_starts_with($lower, '0x')) {
                $digits = substr($lower, 2);
                $digits = ltrim($digits, '0');
                if (strlen($digits) > 8) {
                    return false;
                }
                $values[] = $digits === '' ? 0 : hexdec($digits);
            } elseif (strlen($part) > 1 && $part[0] === '0') {
                $digits = ltrim($part, '0');
                if ($digits !== '' && preg_match('/^[0-7]+$/', $digits) !== 1) {
                    return false;
                }
                if (strlen($digits) > 11) {
                    return false;
                }
                $values[] = $digits === '' ? 0 : octdec($digits);
            } else {
                if (strlen($part) > 10) {
                    return false;
                }
                $values[] = (int) $part;
            }
        }

        $count = count($values);
        $last = array_pop($values);
        foreach ($values as $v) {
            if ($v > 255) {
                return false;
            }
        }
        $lastMax = (1 << (8 * (5 - $count))) - 1;
        if ($last > $lastMax) {
            return false;
        }

        $number = 0;
        foreach ($values as $i => $v) {
            $number |= $v << (8 * (3 - $i));
        }
        $number |= $last;

        return long2ip($number);
    }

    /**
     * IPv4-mapped(::ffff:a.b.c.d)·IPv4-compatible(::a.b.c.d) 주소의 내장 IPv4 를 꺼낸다.
     *
     * @param  string  $bin  16바이트 IPv6 주소
     * @return string|null 내장 IPv4, 해당 형식이 아니면 null
     */
    private static function embeddedIpv4(string $bin): ?string
    {
        $prefix = substr($bin, 0, 10);
        if ($prefix !== str_repeat("\0", 10)) {
            return null;
        }

        $marker = substr($bin, 10, 2);
        if ($marker === "\xff\xff" || $marker === "\0\0") {
            $v4 = inet_ntop(substr($bin, 12, 4));

            return $v4 === false ? null : $v4;
        }

        return null;
    }

    private static function inCidr(string $bin, string $cidr): bool
    {
        [$net, $bits] = explode('/', $cidr);
        $netBin = inet_pton($net);
        if ($netBin === false || strlen($netBin) !== strlen($bin)) {
            return false;
        }

        $bits = (int) $bits;
        $bytes = intdiv($bits, 8);
        if (substr($bin, 0, $bytes) !== substr($netBin, 0, $bytes)) {
            return false;
        }

        $rest = $bits % 8;
        if ($rest === 0) {
            return true;
        }

        $mask = (0xFF << (8 - $rest)) & 0xFF;

        return (ord($bin[$bytes]) & $mask) === (ord($netBin[$bytes]) & $mask);
    }

    private static function globalFlags(): int
    {
        return defined('FILTER_FLAG_GLOBAL_RANGE')
            ? FILTER_FLAG_GLOBAL_RANGE
            : (FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE);
    }
}
