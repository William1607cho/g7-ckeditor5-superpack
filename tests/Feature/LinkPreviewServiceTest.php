<?php

namespace Plugins\G7\Ckeditor5\Superpack\Tests\Feature;

require_once dirname(__DIR__).'/PluginTestCase.php';

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\RateLimiter;
use PHPUnit\Framework\Attributes\DataProvider;
use Plugins\G7\Ckeditor5\Superpack\Contracts\LinkPreviewFetcher;
use Plugins\G7\Ckeditor5\Superpack\Models\LinkPreview;
use Plugins\G7\Ckeditor5\Superpack\Services\CurlLinkPreviewFetcher;
use Plugins\G7\Ckeditor5\Superpack\Services\LinkPreviewService;
use Plugins\G7\Ckeditor5\Superpack\Support\LinkPreviewFetchResult;
use Plugins\G7\Ckeditor5\Superpack\Tests\PluginTestCase;
use Plugins\G7\Ckeditor5\Superpack\Tests\Support\FakeLinkPreviewFetcher as Fake;

/**
 * 링크 프리뷰 서비스 (1.4.0)
 *
 * 외부 요청 없이 가짜 수신기로 확인한다. 접속 대상은 DNS 조회가 필요 없는 공개 IP 리터럴.
 *
 * - 상태 판정: ok / minimal / empty / failed, 캐시 적중 시 재요청 없음
 * - 크기: 잘린 본문 파싱, 1 MiB 뒤의 내용 무시, 압축 응답 실패
 * - 리다이렉트: 공개 대상 추적, 한도(요청 4회) 초과 실패, 내부 대상·숫자형 표기 차단, 상대 경로
 * - 빈도 제한: 전체·호스트별 초과 시 실패 + 미저장, 캐시 적중은 세지 않음
 * - 기타: 긴 image/favicon URL 버림, 요청 중 다른 요청의 행 선저장, 잘못된 UTF-8, 실패 로그에 URL 없음
 */
class LinkPreviewServiceTest extends PluginTestCase
{
    private const URL = 'http://1.1.1.1/article';

    private function row(string $url): ?LinkPreview
    {
        return LinkPreview::query()->where('url_hash', hash('sha256', $url))->first();
    }

    // ── 상태 판정 ───────────────────────────────────────────

    public function test_og_page_becomes_ok_card_and_is_cached(): void
    {
        $fake = $this->fakeFetcher()->push(Fake::html(Fake::ogPage()));
        $service = $this->service($fake);

        $data = $service->get(self::URL);

        $this->assertSame('ok', $data['status']);
        $this->assertSame('OG 제목', $data['title']);
        $this->assertSame('요약', $data['description']);
        $this->assertSame('http://1.1.1.1/img.png', $data['image']);
        $this->assertSame('1.1.1.1', $data['domain']);
        $this->assertNotNull($this->row(self::URL));

        // 캐시 적중 — 준비된 결과가 없으므로 다시 요청하면 예외가 난다.
        $again = $service->get(self::URL);
        $this->assertSame('ok', $again['status']);
        $this->assertCount(1, $fake->calls);
    }

    public function test_title_only_page_is_minimal(): void
    {
        $fake = $this->fakeFetcher()->push(Fake::html('<html><head><title>제목만</title></head></html>'));

        $data = $this->service($fake)->get(self::URL);

        $this->assertSame('minimal', $data['status']);
        $this->assertSame('제목만', $data['title']);
    }

    public function test_page_without_title_is_empty(): void
    {
        $fake = $this->fakeFetcher()->push(Fake::html('<html><head></head><body>x</body></html>'));

        $this->assertSame('empty', $this->service($fake)->get(self::URL)['status']);
    }

    public function test_error_status_with_title_is_minimal_without_rich_meta(): void
    {
        $fake = $this->fakeFetcher()->push(Fake::html(Fake::ogPage('챌린지'), 403));

        $data = $this->service($fake)->get(self::URL);

        $this->assertSame('minimal', $data['status']);
        $this->assertSame('태그 제목', $data['title']);
        $this->assertNull($data['image']);
        $this->assertNull($data['description']);
    }

    public function test_error_status_without_title_is_failed(): void
    {
        $fake = $this->fakeFetcher()->push(Fake::html('<html><head></head></html>', 500));

        $this->assertSame('failed', $this->service($fake)->get(self::URL)['status']);
    }

    public function test_non_html_success_is_empty(): void
    {
        $fake = $this->fakeFetcher()->push(Fake::notHtml(200, 'video/mp4'));

        $this->assertSame('empty', $this->service($fake)->get(self::URL)['status']);
    }

    public function test_non_html_error_is_failed(): void
    {
        $fake = $this->fakeFetcher()->push(Fake::notHtml(404, 'application/json'));

        $this->assertSame('failed', $this->service($fake)->get(self::URL)['status']);
    }

    // ── 크기 ────────────────────────────────────────────────

    public function test_truncated_body_is_parsed_from_received_part(): void
    {
        $body = Fake::ogPage('앞부분').str_repeat('x', 1000);
        $fake = $this->fakeFetcher()->push(Fake::html($body, 200, 'text/html', LinkPreviewFetchResult::TRUNCATED));

        $data = $this->service($fake)->get(self::URL);

        $this->assertSame('ok', $data['status']);
        $this->assertSame('앞부분', $data['title']);
    }

    public function test_content_beyond_parse_limit_is_ignored(): void
    {
        $body = '<html>'.str_repeat('x', LinkPreviewFetcher::MAX_BODY_BYTES).'<head><title>늦은 제목</title></head></html>';
        $fake = $this->fakeFetcher()->push(Fake::html($body));

        $this->assertSame('empty', $this->service($fake)->get(self::URL)['status']);
    }

    public function test_compressed_response_is_failed(): void
    {
        $fake = $this->fakeFetcher()->push(Fake::encoded());

        $this->assertSame('failed', $this->service($fake)->get(self::URL)['status']);
    }

    public function test_transport_error_is_failed_and_log_has_host_only(): void
    {
        Log::spy();
        $fake = $this->fakeFetcher()->push(Fake::error(28));

        $this->assertSame('failed', $this->service($fake)->get(self::URL.'?secret=1')['status']);

        Log::shouldHaveReceived('info')->withArgs(function (string $message, array $context) {
            return str_contains($message, 'link-preview')
                && ($context['host'] ?? null) === '1.1.1.1'
                && ($context['code'] ?? null) === 28
                && ! array_key_exists('url', $context)
                && ! str_contains(json_encode($context), 'secret');
        })->once();
    }

    public function test_first_request_gets_whole_deadline_at_most(): void
    {
        $fake = $this->fakeFetcher()->push(Fake::html(Fake::ogPage()));

        $this->service($fake)->get(self::URL);

        $this->assertGreaterThan(0.0, $fake->calls[0]['timeout']);
        $this->assertLessThanOrEqual(8.0, $fake->calls[0]['timeout']);
    }

    // ── 리다이렉트·주소 판정 ────────────────────────────────

    public function test_redirect_to_public_target_is_followed(): void
    {
        $fake = $this->fakeFetcher()->push(
            Fake::redirect('http://8.8.8.8/next'),
            Fake::html(Fake::ogPage('도착')),
        );

        $data = $this->service($fake)->get(self::URL);

        $this->assertSame('ok', $data['status']);
        $this->assertSame('도착', $data['title']);
        $this->assertCount(2, $fake->calls);
        $this->assertSame('8.8.8.8', $fake->calls[1]['ip']);
        $this->assertSame('http://8.8.8.8/next', $fake->calls[1]['url']);
        // 이미지 상대 경로는 최종 URL 기준
        $this->assertSame('http://8.8.8.8/img.png', $data['image']);
    }

    public function test_relative_redirect_is_resolved_against_current_url(): void
    {
        $fake = $this->fakeFetcher()->push(
            Fake::redirect('/moved'),
            Fake::html(Fake::ogPage()),
        );

        $this->service($fake)->get(self::URL);

        $this->assertSame('http://1.1.1.1/moved', $fake->calls[1]['url']);
    }

    public function test_redirect_cap_ends_in_failed(): void
    {
        $fake = $this->fakeFetcher()->push(
            Fake::redirect('http://1.1.1.1/a'),
            Fake::redirect('http://1.1.1.1/b'),
            Fake::redirect('http://1.1.1.1/c'),
            Fake::redirect('http://1.1.1.1/d'),
        );

        $data = $this->service($fake)->get(self::URL);

        $this->assertSame('failed', $data['status']);
        $this->assertNull($data['title']);
        $this->assertCount(4, $fake->calls);
    }

    public function test_redirect_without_location_is_failed(): void
    {
        $fake = $this->fakeFetcher()->push(new LinkPreviewFetchResult(LinkPreviewFetchResult::REDIRECT, 301, []));

        $this->assertSame('failed', $this->service($fake)->get(self::URL)['status']);
    }

    /**
     * @return array<string, array{0: string}>
     */
    public static function internalUrls(): array
    {
        return [
            '루프백' => ['http://127.0.0.1/'],
            'mapped 루프백' => ['http://[::ffff:127.0.0.1]/'],
            'mapped 루프백 16진' => ['http://[::ffff:7f00:1]:8080/'],
            'mapped 사설' => ['http://[::ffff:172.30.0.1]/'],
            'CGNAT' => ['http://100.64.0.1/'],
            'CGNAT 포트' => ['http://100.100.100.100:8443/'],
            '벤치마크' => ['http://198.18.0.1/'],
            'IETF' => ['http://192.0.0.1/'],
            '10진수' => ['http://2130706433/'],
            '8진수' => ['http://0177.0.0.1/'],
            '16진수' => ['http://0x7f.1/'],
            '축약' => ['http://127.1/'],
            'ULA' => ['http://[fd00::1]/'],
            'Tailscale ULA' => ['http://[fd7a:115c:a1e0::1]/'],
            'NAT64' => ['http://[64:ff9b::7f00:1]/'],
            '6to4' => ['http://[2002:7f00:1::1]/'],
            '메타데이터' => ['http://169.254.169.254/latest/meta-data/'],
            'localhost' => ['http://localhost/'],
            'userinfo' => ['http://user@1.1.1.1/'],
            'ftp' => ['ftp://1.1.1.1/'],
        ];
    }

    #[DataProvider('internalUrls')]
    public function test_internal_input_url_is_rejected_without_request(string $url): void
    {
        $fake = $this->fakeFetcher();

        $data = $this->service($fake)->get($url);

        $this->assertSame('failed', $data['status']);
        $this->assertCount(0, $fake->calls);
    }

    #[DataProvider('internalUrls')]
    public function test_redirect_to_internal_target_is_not_followed(string $location): void
    {
        $fake = $this->fakeFetcher()->push(Fake::redirect($location));

        $data = $this->service($fake)->get(self::URL);

        $this->assertSame('failed', $data['status']);
        $this->assertCount(1, $fake->calls);
    }

    public function test_ip_literal_host_is_passed_as_is(): void
    {
        $fake = $this->fakeFetcher()->push(Fake::html(Fake::ogPage()));

        $this->service($fake)->get('http://[2606:4700:4700::1111]:8080/x');

        $this->assertSame('2606:4700:4700::1111', $fake->calls[0]['host']);
        $this->assertSame('2606:4700:4700::1111', $fake->calls[0]['ip']);
        $this->assertSame(8080, $fake->calls[0]['port']);
        $this->assertSame('http://[2606:4700:4700::1111]:8080/x', $fake->calls[0]['url']);
    }

    // ── 빈도 제한 ───────────────────────────────────────────

    public function test_global_limit_returns_failed_without_request_or_row(): void
    {
        for ($i = 0; $i < LinkPreviewService::LIMIT_GLOBAL_PER_MINUTE; $i++) {
            RateLimiter::hit($this->globalLimitKey(), 60);
        }
        $fake = $this->fakeFetcher();

        $data = $this->service($fake)->get(self::URL);

        $this->assertSame('failed', $data['status']);
        $this->assertCount(0, $fake->calls);
        $this->assertNull($this->row(self::URL));
    }

    public function test_host_limit_only_blocks_that_host(): void
    {
        for ($i = 0; $i < LinkPreviewService::LIMIT_HOST_PER_MINUTE; $i++) {
            RateLimiter::hit($this->hostLimitKey('1.1.1.1'), 60);
        }
        $fake = $this->fakeFetcher()->push(Fake::html(Fake::ogPage()));
        $service = $this->service($fake);

        $this->assertSame('failed', $service->get(self::URL)['status']);
        $this->assertNull($this->row(self::URL));

        $this->assertSame('ok', $service->get('http://9.9.9.9/')['status']);
        $this->assertCount(1, $fake->calls);
    }

    public function test_host_limit_applies_to_redirect_target(): void
    {
        for ($i = 0; $i < LinkPreviewService::LIMIT_HOST_PER_MINUTE; $i++) {
            RateLimiter::hit($this->hostLimitKey('8.8.8.8'), 60);
        }
        $fake = $this->fakeFetcher()->push(Fake::redirect('http://8.8.8.8/'));

        $this->assertSame('failed', $this->service($fake)->get(self::URL)['status']);
        $this->assertCount(1, $fake->calls);
        $this->assertNull($this->row(self::URL));
    }

    public function test_each_real_request_counts_and_cache_hits_do_not(): void
    {
        $fake = $this->fakeFetcher()->push(
            Fake::redirect('http://8.8.8.8/'),
            Fake::html(Fake::ogPage()),
        );
        $service = $this->service($fake);

        $service->get(self::URL);
        $service->get(self::URL); // 캐시 적중

        $this->assertEquals(2, RateLimiter::attempts($this->globalLimitKey()));
        $this->assertEquals(1, RateLimiter::attempts($this->hostLimitKey('1.1.1.1')));
        $this->assertEquals(1, RateLimiter::attempts($this->hostLimitKey('8.8.8.8')));
    }

    // ── 저장 ────────────────────────────────────────────────

    public function test_overlong_image_and_favicon_urls_are_dropped(): void
    {
        $long = 'http://1.1.1.1/'.str_repeat('a', 2100);
        $head = '<link rel="icon" href="'.$long.'.ico">';
        $page = '<html><head><title>t</title><meta property="og:image" content="'.$long.'.png">'.$head.'</head></html>';
        $fake = $this->fakeFetcher()->push(Fake::html($page));

        $data = $this->service($fake)->get(self::URL);

        $this->assertSame('ok', $data['status']);
        $this->assertNull($data['image']);
        $this->assertNull($data['favicon']);
    }

    public function test_invalid_utf8_title_is_scrubbed_and_saved(): void
    {
        $fake = $this->fakeFetcher()->push(Fake::html("<html><head><title>\xB0\xA1\xB3\xAA</title></head></html>", 200, 'text/html; charset=euc-kr'));

        $data = $this->service($fake)->get(self::URL);

        $this->assertSame('minimal', $data['status']);
        $this->assertTrue(mb_check_encoding((string) $data['title'], 'UTF-8'));
        $this->assertTrue(mb_check_encoding((string) $this->row(self::URL)?->title, 'UTF-8'));
    }

    public function test_row_created_by_another_request_during_fetch_is_not_duplicated(): void
    {
        // 요청하는 사이에 다른 요청이 같은 URL 의 행을 먼저 저장한 상황.
        // (unique 충돌 예외 경로 자체는 테스트 트랜잭션 안에서 재현되지 않는다 — Laravel 의
        //  createOrFirst 가 세이브포인트를 되돌리며 미리 넣은 행까지 지우기 때문이다.)
        $hash = hash('sha256', self::URL);
        $fake = $this->fakeFetcher()->push(function () use ($hash) {
            DB::table((new LinkPreview)->getTable())->insert([
                'url_hash' => $hash,
                'url' => self::URL,
                'status' => 'minimal',
                'title' => '먼저 저장됨',
                'fetched_at' => now(),
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            return Fake::html(Fake::ogPage());
        });

        $data = $this->service($fake)->get(self::URL);

        $this->assertSame('ok', $data['status']);
        $this->assertSame(1, LinkPreview::query()->where('url_hash', $hash)->count());
    }

    public function test_non_http_redirect_scheme_is_not_treated_as_relative_path(): void
    {
        $fake = $this->fakeFetcher()->push(Fake::redirect('javascript:alert(1)'));

        $this->assertSame('failed', $this->service($fake)->get(self::URL)['status']);
        $this->assertCount(1, $fake->calls);
    }

    public function test_expired_row_is_refetched(): void
    {
        $this->makeRow('failed', now()->subHours(25), [
            'url_hash' => hash('sha256', self::URL),
            'url' => self::URL,
        ]);
        $fake = $this->fakeFetcher()->push(Fake::html(Fake::ogPage()));

        $this->assertSame('ok', $this->service($fake)->get(self::URL)['status']);
        $this->assertCount(1, $fake->calls);
        $this->assertSame(1, LinkPreview::query()->where('url_hash', hash('sha256', self::URL))->count());
    }

    // ── 컨테이너 ────────────────────────────────────────────

    public function test_container_uses_bound_fetcher(): void
    {
        // 플러그인이 활성화돼 프로바이더가 부팅된 환경이면 기본 바인딩은 curl 수신기다.
        app()->forgetInstance(LinkPreviewFetcher::class);
        if (app()->bound(LinkPreviewFetcher::class)) {
            $this->assertInstanceOf(CurlLinkPreviewFetcher::class, app(LinkPreviewFetcher::class));
        }

        $fake = $this->fakeFetcher()->push(Fake::html(Fake::ogPage()));

        $this->assertSame('ok', app(LinkPreviewService::class)->get(self::URL)['status']);
        $this->assertCount(1, $fake->calls);
    }
}
