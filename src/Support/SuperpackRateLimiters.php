<?php

namespace Plugins\G7\Ckeditor5\Superpack\Support;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;

/**
 * 슈퍼팩 라우트 전용 이름 있는 제한기.
 *
 * 이름 없는 `throttle:N,1` 은 키가 `sha1(회원 id)` 또는 `sha1('|'.IP)` 이고 한도 값이 키에
 * 들어가지 않는다. 그래서 게시판·메뉴 같은 코어 공개 API(`throttle:600,1`)와 카운터 하나를
 * 같이 쓰고, 방문자가 둘러보기만 해도 링크 프리뷰(30)가 먼저 막혔다. 이름 있는 제한기는
 * 키가 `md5(제한기 이름 . by 값)` 이라 다른 API 와 섞이지 않는다.
 *
 * 등록은 `SuperpackServiceProvider::boot()` 에서 한다. 코어 `PluginServiceProvider` 가
 * 플러그인 프로바이더를 `PluginRouteServiceProvider` 보다 먼저 부팅하므로 라우트보다 앞선다.
 * 라우트 파일 안에서 등록하면 라우트 캐시가 있을 때 실행되지 않아, 제한기가 없는 채로
 * 요청이 들어와 `MissingRateLimiterException`(500)이 난다.
 *
 * 초과 응답은 지정하지 않는다 — 기존과 같은 코어 기본 429 형식을 유지한다.
 */
class SuperpackRateLimiters
{
    /** 링크 프리뷰 (공개, 인증 헤더 없음 → 사실상 IP) */
    public const LINK_PREVIEW = 'g7-ckeditor5-superpack.link-preview';

    /** 동영상 업로드 init·complete (업로드 1건당 각 1회) */
    public const VIDEO_SESSION = 'g7-ckeditor5-superpack.video-session';

    /** 동영상 업로드 청크 */
    public const VIDEO_CHUNK = 'g7-ckeditor5-superpack.video-chunk';

    /** 편집 화면 동영상 메타 일괄 조회 */
    public const VIDEO_META = 'g7-ckeditor5-superpack.video-meta';

    /** 동영상 스트리밍 (공개, Range 요청) */
    public const VIDEO_SERVE = 'g7-ckeditor5-superpack.video-serve';

    /** 분당 허용 횟수 */
    public const LIMITS = [
        self::LINK_PREVIEW => 60,
        self::VIDEO_SESSION => 60,
        self::VIDEO_CHUNK => 1200,
        self::VIDEO_META => 120,
        self::VIDEO_SERVE => 600,
    ];

    /**
     * 제한기를 등록한다. 같은 이름으로 다시 부르면 덮어쓸 뿐이라 여러 번 불러도 안전하다.
     */
    public static function register(): void
    {
        foreach (self::LIMITS as $name => $perMinute) {
            RateLimiter::for($name, fn (Request $request) => Limit::perMinute($perMinute)->by(self::keyFor($request)));
        }
    }

    public static function keyFor(Request $request): string
    {
        return SuperpackRateLimitKey::resolve($request->user()?->getAuthIdentifier(), $request->ip());
    }
}
