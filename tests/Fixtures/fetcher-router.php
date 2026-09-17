<?php

/**
 * CurlLinkPreviewFetcherTest 전용 루프백 서버 라우터 (`php -S 127.0.0.1:<port> fetcher-router.php`).
 * 외부 네트워크를 쓰지 않고 수신기의 크기·형식·리다이렉트·타임아웃 처리를 확인하기 위한 응답만 낸다.
 */
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);

switch ($path) {
    case '/html':
        header('Content-Type: text/html; charset=utf-8');
        echo '<!doctype html><html><head><title>루프백 제목</title></head><body>ok</body></html>';
        break;

    case '/big':
        // 3 MiB — 수신기는 1 MiB 에서 끊어야 한다
        header('Content-Type: text/html; charset=utf-8');
        echo '<html><head><title>큰 페이지</title></head><body>';
        $chunk = str_repeat('x', 65536);
        for ($i = 0; $i < 48; $i++) {
            echo $chunk;
            flush();
        }
        echo '</body></html>';
        break;

    case '/json':
        header('Content-Type: application/json');
        echo json_encode(['big' => str_repeat('x', 1024 * 1024)]);
        break;

    case '/gzip':
        header('Content-Type: text/html; charset=utf-8');
        header('Content-Encoding: gzip');
        echo gzencode('<html><head><title>압축</title></head></html>');
        break;

    case '/redirect':
        header('Location: /html', true, 302);
        header('Content-Type: text/html');
        echo str_repeat('redirect body ', 1000);
        break;

    case '/echo-headers':
        header('Content-Type: text/html; charset=utf-8');
        echo '<html><head><title>'.htmlspecialchars($_SERVER['HTTP_ACCEPT_ENCODING'] ?? '(none)').'</title></head></html>';
        break;

    case '/slow':
        header('Content-Type: text/html; charset=utf-8');
        sleep(3);
        echo '<html><head><title>늦음</title></head></html>';
        break;

    default:
        http_response_code(404);
        header('Content-Type: text/plain');
        echo 'not found';
}
