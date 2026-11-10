<?php

namespace Plugins\G7\Ckeditor5\Superpack\Tests\Unit;

require_once dirname(__DIR__).'/PluginTestCase.php';

use PHPUnit\Framework\TestCase;
use Plugins\G7\Ckeditor5\Superpack\Support\SuperpackRateLimiters;

/**
 * 라우트 파일이 문자열로 적은 제한기 이름이 등록 목록과 같은지 (1.7.0).
 *
 * 글쓰기 도우미 라우트는 plugin:update 1회차(옛 클래스가 메모리에 남은 프로세스)에서도 라우트 등록이
 * 깨지지 않게 상수 대신 문자열을 쓴다. 그 문자열이 `SuperpackRateLimiters::WRITE_CONFIG` 와 어긋나면
 * 요청 때 MissingRateLimiterException(500)이 나므로 여기서 대조한다.
 */
class RouteLimiterNamesTest extends TestCase
{
    private function routes(): string
    {
        return (string) file_get_contents(dirname(__DIR__, 2).'/src/routes/api.php');
    }

    public function test_write_config_literal_matches_constant_and_is_registered(): void
    {
        $this->assertStringContainsString("'throttle:".SuperpackRateLimiters::WRITE_CONFIG."'", $this->routes());
        $this->assertSame(60, SuperpackRateLimiters::LIMITS[SuperpackRateLimiters::WRITE_CONFIG]);
    }

    public function test_every_literal_throttle_name_is_registered(): void
    {
        preg_match_all("/'throttle:(g7-ckeditor5-superpack\\.[a-z-]+)'/", $this->routes(), $m);
        $this->assertGreaterThanOrEqual(1, count($m[1]));
        foreach ($m[1] as $name) {
            $this->assertTrue(isset(SuperpackRateLimiters::LIMITS[$name]), $name);
        }
    }

    public function test_write_config_route_exists(): void
    {
        $this->assertStringContainsString("Route::get('write-config', [WriteAssistController::class, 'show'])", $this->routes());
    }
}
