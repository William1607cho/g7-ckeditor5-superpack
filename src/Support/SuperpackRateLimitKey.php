<?php

namespace Plugins\G7\Ckeditor5\Superpack\Support;

/**
 * 이름 있는 제한기의 카운터 키 계산 (HTTP·DB 없이 값만 받는 순수 함수).
 *
 * - 로그인 회원이면 `user:<id>`, 아니면 `ip:<요청 IP>`.
 * - 접두어로 두 종류가 서로의 키를 먹지 않게 한다(IP 문자열과 회원 id 가 우연히 같아도 분리).
 * - 제한기끼리의 분리는 이 키가 아니라 제한기 이름이 한다 — `ThrottleRequests` 가
 *   `md5(제한기 이름 . 키)` 로 저장하므로 같은 키라도 제한기마다 따로 센다.
 */
final class SuperpackRateLimitKey
{
    public static function resolve(int|string|null $userId, ?string $ip): string
    {
        if ($userId !== null && $userId !== '') {
            return 'user:'.$userId;
        }

        return 'ip:'.($ip ?? '');
    }
}
