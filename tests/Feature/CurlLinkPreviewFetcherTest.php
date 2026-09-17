<?php

namespace Plugins\G7\Ckeditor5\Superpack\Tests\Feature;

require_once dirname(__DIR__).'/PluginTestCase.php';

use PHPUnit\Framework\TestCase;
use Plugins\G7\Ckeditor5\Superpack\Contracts\LinkPreviewFetcher;
use Plugins\G7\Ckeditor5\Superpack\Services\CurlLinkPreviewFetcher;
use Plugins\G7\Ckeditor5\Superpack\Support\LinkPreviewFetchResult;

/**
 * curl 수신기 (1.4.0)
 *
 * 테스트가 직접 띄운 루프백 서버(`php -S 127.0.0.1:<임의 포트>`)에만 접속한다. 외부 네트워크와
 * DNS 는 쓰지 않는다. (수신기는 주소 판정을 하지 않으므로 루프백 접속이 가능하다 —
 * 주소 판정은 LinkPreviewService 가 맡는다.)
 *
 * - 본문 1 MiB 에서 끊기, 비HTML·압축 응답은 본문 전에 끊기, 3xx 는 본문 없이 끊기
 * - `Accept-Encoding: identity` 전송, `CURLOPT_RESOLVE` 고정(.invalid 호스트로 접속)
 * - 환경변수 프록시 무시, 연결 실패·타임아웃은 error
 *
 * 타임아웃 테스트는 서버 워커를 붙잡으므로 마지막에 둔다.
 */
class CurlLinkPreviewFetcherTest extends TestCase
{
    /** @var resource|null */
    private static $server = null;

    private static int $port = 0;

    private static bool $ready = false;

    public static function setUpBeforeClass(): void
    {
        parent::setUpBeforeClass();

        if (! function_exists('proc_open') || ! function_exists('curl_init') || PHP_BINARY === '') {
            return;
        }

        self::$port = self::freePort();
        if (self::$port === 0) {
            return;
        }

        $router = dirname(__DIR__).'/Fixtures/fetcher-router.php';
        $env = array_merge(getenv(), ['PHP_CLI_SERVER_WORKERS' => '4']);
        $pipes = [];
        self::$server = @proc_open(
            [PHP_BINARY, '-S', '127.0.0.1:'.self::$port, $router],
            [0 => ['pipe', 'r'], 1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']],
            $pipes,
            null,
            $env,
        );
        if (! is_resource(self::$server)) {
            self::$server = null;

            return;
        }

        $deadline = microtime(true) + 5;
        while (microtime(true) < $deadline) {
            $conn = @fsockopen('127.0.0.1', self::$port, $errno, $errstr, 0.2);
            if ($conn !== false) {
                fclose($conn);
                self::$ready = true;
                break;
            }
            usleep(100_000);
        }
    }

    public static function tearDownAfterClass(): void
    {
        if (is_resource(self::$server)) {
            proc_terminate(self::$server);
            proc_close(self::$server);
        }
        self::$server = null;
        self::$ready = false;

        parent::tearDownAfterClass();
    }

    protected function setUp(): void
    {
        parent::setUp();

        if (! self::$ready) {
            $this->markTestSkipped('루프백 테스트 서버(php -S)를 띄울 수 없는 환경이다.');
        }
    }

    private static function freePort(): int
    {
        $socket = @stream_socket_server('tcp://127.0.0.1:0', $errno, $errstr);
        if ($socket === false) {
            return 0;
        }
        $name = stream_socket_get_name($socket, false);
        fclose($socket);

        return (int) substr((string) strrchr((string) $name, ':'), 1);
    }

    private function fetch(string $path, float $timeout = 5.0, string $host = '127.0.0.1'): LinkPreviewFetchResult
    {
        $url = 'http://'.$host.':'.self::$port.$path;

        return (new CurlLinkPreviewFetcher)->fetch($url, $host, self::$port, '127.0.0.1', $timeout);
    }

    public function test_html_is_received_completely(): void
    {
        $result = $this->fetch('/html');

        $this->assertSame(LinkPreviewFetchResult::COMPLETE, $result->outcome);
        $this->assertSame(200, $result->status);
        $this->assertStringContainsString('루프백 제목', $result->body);
        $this->assertStringContainsString('text/html', (string) $result->header('Content-Type'));
    }

    public function test_body_is_cut_at_one_mebibyte(): void
    {
        $result = $this->fetch('/big');

        $this->assertSame(LinkPreviewFetchResult::TRUNCATED, $result->outcome);
        $this->assertSame(200, $result->status);
        $this->assertSame(LinkPreviewFetcher::MAX_BODY_BYTES, strlen($result->body));
        $this->assertStringStartsWith('<html><head><title>큰 페이지</title>', $result->body);
    }

    public function test_non_html_is_stopped_before_body(): void
    {
        $result = $this->fetch('/json');

        $this->assertSame(LinkPreviewFetchResult::NOT_HTML, $result->outcome);
        $this->assertSame(200, $result->status);
        $this->assertSame('', $result->body);
    }

    public function test_non_html_error_keeps_status(): void
    {
        $result = $this->fetch('/missing');

        $this->assertSame(LinkPreviewFetchResult::NOT_HTML, $result->outcome);
        $this->assertSame(404, $result->status);
    }

    public function test_compressed_response_is_stopped_before_body(): void
    {
        $result = $this->fetch('/gzip');

        $this->assertSame(LinkPreviewFetchResult::ENCODED, $result->outcome);
        $this->assertSame('', $result->body);
    }

    public function test_redirect_is_not_followed_and_body_is_not_read(): void
    {
        $result = $this->fetch('/redirect');

        $this->assertSame(LinkPreviewFetchResult::REDIRECT, $result->outcome);
        $this->assertSame(302, $result->status);
        $this->assertSame('/html', $result->header('Location'));
        $this->assertSame('', $result->body);
    }

    public function test_identity_encoding_is_requested(): void
    {
        $result = $this->fetch('/echo-headers');

        $this->assertSame(LinkPreviewFetchResult::COMPLETE, $result->outcome);
        $this->assertStringContainsString('<title>identity</title>', $result->body);
    }

    public function test_connection_is_pinned_to_given_ip(): void
    {
        // .invalid 는 절대 해석되지 않는다 — 접속되면 CURLOPT_RESOLVE 고정이 쓰인 것이다.
        $result = $this->fetch('/html', 5.0, 'pinned.invalid');

        $this->assertSame(LinkPreviewFetchResult::COMPLETE, $result->outcome);
        $this->assertStringContainsString('루프백 제목', $result->body);
    }

    public function test_proxy_environment_variables_are_ignored(): void
    {
        $names = ['http_proxy', 'HTTP_PROXY', 'https_proxy', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY'];
        $saved = [];
        foreach ($names as $name) {
            $saved[$name] = getenv($name);
            // 닫힌 포트 — 프록시를 쓰면 연결 실패로 끝난다
            putenv($name.'=http://127.0.0.1:9');
        }
        // no_proxy 가 루프백을 제외하고 있으면 이 테스트가 의미를 잃으므로 비운다.
        $savedNoProxy = ['no_proxy' => getenv('no_proxy'), 'NO_PROXY' => getenv('NO_PROXY')];
        putenv('no_proxy');
        putenv('NO_PROXY');

        try {
            $result = $this->fetch('/html');
        } finally {
            foreach ($saved + $savedNoProxy as $name => $value) {
                putenv($value === false ? $name : $name.'='.$value);
            }
        }

        $this->assertSame(LinkPreviewFetchResult::COMPLETE, $result->outcome);
        $this->assertStringContainsString('루프백 제목', $result->body);
    }

    public function test_connection_failure_is_error(): void
    {
        $closed = self::freePort();
        if ($closed === 0) {
            $this->markTestSkipped('빈 포트를 구할 수 없다.');
        }

        $result = (new CurlLinkPreviewFetcher)->fetch('http://127.0.0.1:'.$closed.'/', '127.0.0.1', $closed, '127.0.0.1', 3.0);

        $this->assertSame(LinkPreviewFetchResult::ERROR, $result->outcome);
        $this->assertNotSame(0, $result->errorCode);
    }

    public function test_timeout_is_error(): void
    {
        $started = microtime(true);
        $result = $this->fetch('/slow', 1.0);
        $elapsed = microtime(true) - $started;

        $this->assertSame(LinkPreviewFetchResult::ERROR, $result->outcome);
        $this->assertSame(28, $result->errorCode); // CURLE_OPERATION_TIMEDOUT
        $this->assertLessThan(2.5, $elapsed);
    }
}
