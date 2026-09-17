<?php

namespace Plugins\G7\Ckeditor5\Superpack\Tests\Unit;

require_once dirname(__DIR__).'/PluginTestCase.php';

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Plugins\G7\Ckeditor5\Superpack\Support\OutboundIpGuard;

/**
 * 링크 프리뷰 접속 IP 판정 (1.4.0)
 *
 * - 코어 판정(NO_PRIV|NO_RES)이 PHP 8.2 에서 통과시키던 CGNAT·벤치마크·IETF·mapped 주소 차단
 * - IPv4-mapped/compatible 은 내장 IPv4 로 재판정 (공개 IPv4 를 담은 mapped 는 공개)
 * - 숫자형 IPv4 표기(10진·8진·16진·축약)는 inet_aton 규칙으로 해석
 */
class OutboundIpGuardTest extends TestCase
{
    /**
     * @return array<string, array{0: string}>
     */
    public static function blockedIps(): array
    {
        return [
            'CGNAT 시작' => ['100.64.0.1'],
            'CGNAT 끝' => ['100.127.255.254'],
            '벤치마크' => ['198.18.0.1'],
            '벤치마크 끝' => ['198.19.255.254'],
            'IETF 할당' => ['192.0.0.1'],
            '이 네트워크' => ['0.1.2.3'],
            '0.0.0.0' => ['0.0.0.0'],
            '루프백' => ['127.0.0.1'],
            '사설 10' => ['10.0.0.1'],
            '사설 172' => ['172.17.0.1'],
            '사설 192' => ['192.168.1.1'],
            '메타데이터' => ['169.254.169.254'],
            '문서용' => ['203.0.113.5'],
            '브로드캐스트' => ['255.255.255.255'],
            'mapped 루프백' => ['::ffff:127.0.0.1'],
            'mapped 루프백 16진' => ['::ffff:7f00:1'],
            'mapped CGNAT' => ['::ffff:100.64.0.1'],
            'mapped 사설' => ['::ffff:10.0.0.1'],
            'mapped 메타데이터' => ['::ffff:169.254.169.254'],
            'mapped 대괄호' => ['[::ffff:127.0.0.1]'],
            'compatible 루프백' => ['::127.0.0.1'],
            'IPv6 루프백' => ['::1'],
            'IPv6 미지정' => ['::'],
            'ULA fd00' => ['fd00::1'],
            'ULA fc00' => ['fc00::1'],
            'Tailscale ULA' => ['fd7a:115c:a1e0::1'],
            '링크로컬' => ['fe80::1'],
            'NAT64' => ['64:ff9b::808:808'],
            '6to4' => ['2002:808:808::1'],
            'IP 아님' => ['example.com'],
            '빈 값' => [''],
            '영역 ID' => ['fe80::1%eth0'],
        ];
    }

    #[DataProvider('blockedIps')]
    public function test_blocked_ips_are_not_public(string $ip): void
    {
        $this->assertFalse(OutboundIpGuard::isPublicIp($ip), $ip);
    }

    /**
     * @return array<string, array{0: string}>
     */
    public static function publicIps(): array
    {
        return [
            'IPv4' => ['1.1.1.1'],
            'IPv4 (CGNAT 바로 위)' => ['100.128.0.1'],
            'IPv4 (CGNAT 바로 아래)' => ['100.63.255.254'],
            'IPv6' => ['2606:4700:4700::1111'],
            'IPv6 대괄호' => ['[2001:4860:4860::8888]'],
            'mapped 공개' => ['::ffff:8.8.8.8'],
        ];
    }

    #[DataProvider('publicIps')]
    public function test_public_ips_pass(string $ip): void
    {
        $this->assertTrue(OutboundIpGuard::isPublicIp($ip), $ip);
    }

    /**
     * @return array<string, array{0: string, 1: array<string, string>}>
     */
    public static function hostForms(): array
    {
        return [
            '10진수' => ['2130706433', ['kind' => 'ip', 'ip' => '127.0.0.1']],
            '8진수 옥텟' => ['0177.0.0.1', ['kind' => 'ip', 'ip' => '127.0.0.1']],
            '16진수 축약' => ['0x7f.1', ['kind' => 'ip', 'ip' => '127.0.0.1']],
            '16진수 전체' => ['0x7f000001', ['kind' => 'ip', 'ip' => '127.0.0.1']],
            '8진수 전체' => ['017700000001', ['kind' => 'ip', 'ip' => '127.0.0.1']],
            '두 부분 축약' => ['127.1', ['kind' => 'ip', 'ip' => '127.0.0.1']],
            '세 부분 축약' => ['10.1.2', ['kind' => 'ip', 'ip' => '10.1.0.2']],
            '대문자 16진' => ['0X7F.0.0.1', ['kind' => 'ip', 'ip' => '127.0.0.1']],
            '끝 점' => ['127.0.0.1.', ['kind' => 'ip', 'ip' => '127.0.0.1']],
            '선행 0 옥텟' => ['1.2.3.04', ['kind' => 'ip', 'ip' => '1.2.3.4']],
            '공개 10진수' => ['134744072', ['kind' => 'ip', 'ip' => '8.8.8.8']],
            '일반 IPv4' => ['8.8.8.8', ['kind' => 'ip', 'ip' => '8.8.8.8']],
            'IPv6 대괄호' => ['[::ffff:127.0.0.1]', ['kind' => 'ip', 'ip' => '::ffff:127.0.0.1']],
            '잘못된 8진수' => ['08.0.0.1', ['kind' => 'invalid']],
            '32비트 초과' => ['4294967296', ['kind' => 'invalid']],
            '옥텟 초과' => ['256.0.0.1', ['kind' => 'invalid']],
            '마지막 부분 초과' => ['1.2.3.256', ['kind' => 'invalid']],
            '긴 16진수' => ['0x1000000000', ['kind' => 'invalid']],
            '도메인' => ['example.com', ['kind' => 'name']],
            '숫자 시작 도메인' => ['1e100.net', ['kind' => 'name']],
            '다섯 부분' => ['1.2.3.4.5', ['kind' => 'name']],
        ];
    }

    /**
     * @param  array<string, string>  $expected
     */
    #[DataProvider('hostForms')]
    public function test_host_forms_are_classified(string $host, array $expected): void
    {
        $this->assertSame($expected, OutboundIpGuard::classifyHost($host));
    }

    public function test_numeric_loopback_forms_are_blocked_after_classification(): void
    {
        foreach (['2130706433', '0177.0.0.1', '0x7f.1', '127.1', '017700000001'] as $host) {
            $kind = OutboundIpGuard::classifyHost($host);
            $this->assertSame('ip', $kind['kind'], $host);
            $this->assertFalse(OutboundIpGuard::isPublicIp($kind['ip']), $host);
        }
    }

    public function test_numeric_cgnat_form_is_blocked(): void
    {
        // 100.64.0.1 = 1681915905
        $kind = OutboundIpGuard::classifyHost('1681915905');
        $this->assertSame(['kind' => 'ip', 'ip' => '100.64.0.1'], $kind);
        $this->assertFalse(OutboundIpGuard::isPublicIp($kind['ip']));
    }
}
