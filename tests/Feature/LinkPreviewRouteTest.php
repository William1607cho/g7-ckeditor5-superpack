<?php

namespace Plugins\G7\Ckeditor5\Superpack\Tests\Feature;

require_once dirname(__DIR__).'/PluginTestCase.php';

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use PHPUnit\Framework\Attributes\DataProvider;
use Plugins\G7\Ckeditor5\Superpack\Http\Requests\LinkPreviewRequest;
use Plugins\G7\Ckeditor5\Superpack\Tests\PluginTestCase;

/**
 * 링크 프리뷰 라우트·요청 검증 (1.4.0)
 *
 * - 라우트 throttle 은 IP 당 분당 30회
 * - 요청 검증(코어 규칙)이 걸러내는 입력 — mapped·CGNAT 는 코어 규칙이 통과시키므로
 *   서비스 테스트(LinkPreviewServiceTest)에서 확인한다.
 */
class LinkPreviewRouteTest extends PluginTestCase
{
    private const URI = '/api/plugins/g7-ckeditor5-superpack/link-preview';

    public function test_route_throttle_is_30_per_minute(): void
    {
        try {
            $route = app('router')->getRoutes()->match(Request::create(self::URI, 'GET'));
        } catch (\Throwable) {
            $this->markTestSkipped('플러그인이 활성화돼 라우트가 등록된 환경에서만 실행한다.');
        }

        $middleware = $route->gatherMiddleware();

        $this->assertContains('throttle:30,1', $middleware);
        $this->assertNotContains('throttle:60,1', $middleware);
        $this->assertSame(['GET', 'HEAD'], $route->methods());
    }

    /**
     * @return array<string, array{0: mixed}>
     */
    public static function rejectedInputs(): array
    {
        return [
            '누락' => [null],
            '스킴 없음' => ['1.1.1.1/x'],
            'ftp' => ['ftp://1.1.1.1/'],
            'javascript' => ['javascript:alert(1)'],
            '루프백' => ['http://127.0.0.1/'],
            '사설' => ['http://10.0.0.1/'],
            '메타데이터' => ['http://169.254.169.254/'],
            'localhost' => ['http://localhost/'],
            '10진수' => ['http://2130706433/'],
            'userinfo' => ['http://a@1.1.1.1/'],
            '너무 김' => ['http://1.1.1.1/'.str_repeat('a', 2100)],
        ];
    }

    #[DataProvider('rejectedInputs')]
    public function test_request_rules_reject_input(mixed $url): void
    {
        $data = $url === null ? [] : ['url' => $url];

        $this->assertTrue(Validator::make($data, (new LinkPreviewRequest)->rules())->fails());
    }

    public function test_request_rules_accept_public_url(): void
    {
        $this->assertTrue(Validator::make(['url' => 'https://1.1.1.1/page'], (new LinkPreviewRequest)->rules())->passes());
    }
}
