<?php

namespace Plugins\G7\Ckeditor5\Superpack\Tests\Unit;

require_once dirname(__DIR__).'/PluginTestCase.php';

use PHPUnit\Framework\TestCase;
use Plugins\G7\Ckeditor5\Superpack\Support\SuperpackRateLimitKey;

/**
 * 제한기 카운터 키 계산 (1.5.0) — 회원이면 `user:<id>`, 아니면 `ip:<IP>`.
 */
class SuperpackRateLimitKeyTest extends TestCase
{
    public function test_member_is_keyed_by_id(): void
    {
        $this->assertSame('user:42', SuperpackRateLimitKey::resolve(42, '203.0.113.10'));
        $this->assertSame('user:abc', SuperpackRateLimitKey::resolve('abc', '203.0.113.10'));
    }

    public function test_guest_is_keyed_by_ip(): void
    {
        $this->assertSame('ip:203.0.113.10', SuperpackRateLimitKey::resolve(null, '203.0.113.10'));
        $this->assertSame('ip:203.0.113.10', SuperpackRateLimitKey::resolve('', '203.0.113.10'));
    }

    public function test_member_and_ip_prefixes_never_collide(): void
    {
        $this->assertNotSame(
            SuperpackRateLimitKey::resolve('203.0.113.10', null),
            SuperpackRateLimitKey::resolve(null, '203.0.113.10')
        );
    }

    public function test_missing_ip_still_yields_a_prefixed_key(): void
    {
        $this->assertSame('ip:', SuperpackRateLimitKey::resolve(null, null));
    }
}
