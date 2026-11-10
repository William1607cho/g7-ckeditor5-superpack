<?php

namespace Plugins\G7\Ckeditor5\Superpack\Tests\Unit;

require_once dirname(__DIR__).'/PluginTestCase.php';

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Plugins\G7\Ckeditor5\Superpack\Support\BotChallengeDetector;

/**
 * 봇 차단 챌린지 페이지 판별 (1.7.0)
 */
class BotChallengeDetectorTest extends TestCase
{
    /**
     * @return array<string, array{0: int, 1: array<string, string>, 2: string}>
     */
    public static function challenges(): array
    {
        return [
            'Cloudflare 403 제목' => [403, [], '<html><head><title>Just a moment...</title></head></html>'],
            'Cloudflare 503 제목' => [503, [], '<title>Just a moment…</title>'],
            'Cloudflare 403 Attention' => [403, [], '<title>Attention Required! | Cloudflare</title>'],
            'cf-mitigated 헤더(200)' => [200, ['cf-mitigated' => 'challenge'], '<title>Anything</title>'],
            'cf-mitigated 헤더 대문자 값' => [403, ['cf-mitigated' => ' Challenge '], ''],
            '본문 표식 challenge-platform' => [403, [], '<title>example.com</title><script src="/cdn-cgi/challenge-platform/h/b/orchestrate"></script>'],
            '본문 표식 _cf_chl_opt' => [503, [], '<script>window._cf_chl_opt={}</script>'],
            'DDoS-Guard' => [403, [], '<title>DDoS-Guard</title>'],
            '429 캡차' => [429, [], '<title>Are you a robot?</title>'],
            '엔티티 제목' => [403, [], '<title>Just a moment&hellip;</title>'],
            '2xx 정확한 챌린지 제목' => [200, [], '<title>Just a moment...</title>'],
            'Access denied 403' => [403, [], '<title>Access Denied</title>'],
            'hCaptcha 본문' => [403, [], '<div class="h-captcha"></div><script src="https://hcaptcha.com/1/api.js"></script>'],
        ];
    }

    /**
     * @param  array<string, string>  $headers
     */
    #[DataProvider('challenges')]
    public function test_challenge_pages_are_detected(int $status, array $headers, string $body): void
    {
        $this->assertTrue(BotChallengeDetector::isChallenge($status, $headers, $body));
    }

    /**
     * @return array<string, array{0: int, 1: array<string, string>, 2: string}>
     */
    public static function normalPages(): array
    {
        return [
            '정상 글' => [200, [], '<title>Just a moment of silence — 에세이</title>'],
            '정상 글 캡차 설명' => [200, [], '<title>How CAPTCHA works</title><p>g-recaptcha</p>'],
            '정상 2xx 제목 없음' => [200, [], '<html><head></head></html>'],
            '404 일반' => [404, [], '<title>Not Found</title>'],
            '500 일반' => [500, [], '<title>Just a moment</title>'],
            '403 일반 제목' => [403, [], '<title>Forbidden</title>'],
            'cf-mitigated 다른 값' => [403, ['cf-mitigated' => 'block-none'], '<title>Forbidden</title>'],
            '빈 본문 403' => [403, [], ''],
        ];
    }

    /**
     * @param  array<string, string>  $headers
     */
    #[DataProvider('normalPages')]
    public function test_normal_pages_are_not_challenges(int $status, array $headers, string $body): void
    {
        $this->assertFalse(BotChallengeDetector::isChallenge($status, $headers, $body));
    }

    public function test_marker_after_scan_window_is_ignored(): void
    {
        $body = '<title>x</title>'.str_repeat('a', 70000).'challenge-platform';
        $this->assertFalse(BotChallengeDetector::isChallenge(403, [], $body));
    }

    public function test_non_utf8_title_does_not_break(): void
    {
        $body = "<title>\xB0\xA1\xB3\xAA</title>";
        $this->assertFalse(BotChallengeDetector::isChallenge(403, [], $body));
    }
}
