<?php

namespace Plugins\G7\Ckeditor5\Superpack\Http\Controllers;

use App\Http\Controllers\Api\Base\AuthBaseController;
use Illuminate\Http\JsonResponse;

/**
 * 글쓰기 도우미 설정 조회 (1.7.0) — 로그인 사용자 전용(AuthBaseController 가 auth:sanctum 적용).
 *
 * `GET /api/plugins/g7-ckeditor5-superpack/write-config`
 *  → { draft: bool, count: bool, user: string }
 *
 * 글쓰기 도우미(임시 저장·글자 수) 켜짐 여부는 방문자 화면 설정(SPA 셸 `plugins:`)에 싣지 않는다.
 * 글쓰기 화면의 스크립트가 로그인한 뒤에만 이 주소로 묻는다. `user` 는 이 브라우저 안에서 임시본을
 * 사용자별로 나누는 데만 쓰는 짧은 해시다(회원 id 를 그대로 내보내지 않는다).
 */
class WriteAssistController extends AuthBaseController
{
    private const PLUGIN = 'g7-ckeditor5-superpack';

    public function __construct()
    {
        parent::__construct();
    }

    public function show(): JsonResponse
    {
        $user = $this->getCurrentUser();
        $id = $user?->getAuthIdentifier();

        return response()->json([
            'draft' => $this->flag('write_draft_enabled'),
            'count' => $this->flag('write_count_enabled'),
            'user' => $id === null ? '' : substr(hash('sha256', 'g7sp-write|'.$id), 0, 16),
        ])->header('Cache-Control', 'private, no-store');
    }

    private function flag(string $key): bool
    {
        try {
            $v = plugin_setting(self::PLUGIN, $key, false);
        } catch (\Throwable) {
            return false;
        }
        if (is_string($v)) {
            return $v !== '' && $v !== '0' && strtolower($v) !== 'false';
        }

        return (bool) $v;
    }
}
