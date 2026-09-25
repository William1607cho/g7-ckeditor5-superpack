<?php

namespace Plugins\G7\Ckeditor5\Superpack\Tests\Feature;

require_once dirname(__DIR__).'/PluginTestCase.php';

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Plugins\G7\Ckeditor5\Superpack\Support\SuperpackRateLimiters;
use Plugins\G7\Ckeditor5\Superpack\Tests\PluginTestCase;

/**
 * 이름 있는 제한기 (1.5.0) — 이름·한도·키가 약속대로 등록되는지 확인한다.
 * 카운터는 올리지 않는다(hit 없음).
 */
class NamedRateLimitersTest extends PluginTestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        SuperpackRateLimiters::register();
    }

    private function limitFor(string $name, Request $request): Limit
    {
        $callback = RateLimiter::limiter($name);
        $this->assertNotNull($callback, "제한기 {$name} 가 등록되지 않았다");

        $limit = $callback($request);
        $this->assertInstanceOf(Limit::class, $limit);

        return $limit;
    }

    private function requestFrom(string $ip, mixed $user = null): Request
    {
        $request = Request::create('/api/plugins/g7-ckeditor5-superpack/link-preview', 'GET', [], [], [], ['REMOTE_ADDR' => $ip]);
        $request->setUserResolver(fn () => $user);

        return $request;
    }

    public function test_limits_are_per_minute_with_expected_counts(): void
    {
        $request = $this->requestFrom('203.0.113.10');

        foreach ([
            SuperpackRateLimiters::LINK_PREVIEW => 60,
            SuperpackRateLimiters::VIDEO_SESSION => 60,
            SuperpackRateLimiters::VIDEO_CHUNK => 1200,
            SuperpackRateLimiters::VIDEO_META => 120,
            SuperpackRateLimiters::VIDEO_SERVE => 600,
        ] as $name => $max) {
            $limit = $this->limitFor($name, $request);
            $this->assertSame($max, $limit->maxAttempts, $name);
            $this->assertSame(60, $limit->decaySeconds, $name);
        }
    }

    public function test_names_are_namespaced_by_plugin_identifier(): void
    {
        foreach (array_keys(SuperpackRateLimiters::LIMITS) as $name) {
            $this->assertStringStartsWith('g7-ckeditor5-superpack.', $name);
        }
    }

    public function test_guest_is_keyed_by_ip(): void
    {
        foreach (array_keys(SuperpackRateLimiters::LIMITS) as $name) {
            $a = $this->limitFor($name, $this->requestFrom('203.0.113.10'));
            $b = $this->limitFor($name, $this->requestFrom('203.0.113.11'));

            $this->assertSame('ip:203.0.113.10', $a->key, $name);
            $this->assertNotSame($a->key, $b->key, $name);
        }
    }

    public function test_member_is_keyed_by_id(): void
    {
        $member = new class
        {
            public function getAuthIdentifier(): int
            {
                return 7;
            }
        };

        $limit = $this->limitFor(SuperpackRateLimiters::VIDEO_CHUNK, $this->requestFrom('203.0.113.10', $member));

        $this->assertSame('user:7', $limit->key);
    }

    public function test_registering_twice_keeps_one_definition(): void
    {
        SuperpackRateLimiters::register();

        $limit = $this->limitFor(SuperpackRateLimiters::LINK_PREVIEW, $this->requestFrom('203.0.113.10'));

        $this->assertSame(60, $limit->maxAttempts);
    }
}
