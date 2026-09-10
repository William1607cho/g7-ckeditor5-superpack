<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * CKEditor 5 슈퍼팩 — 외부 링크 카드(OG 프리뷰) 캐시 테이블.
 *
 * 방문자 화면에서 본문 안의 단독 외부 링크를 대표이미지+제목+요약 카드로 렌더할 때,
 * 서버가 대신 가져온 OG 메타를 정규화 URL 의 sha256 해시 기준으로 캐시한다. 같은 URL
 * 반복 요청 시 상대 서버 부담과 지연을 없앤다.
 *
 * `status`:
 *  - ok      : OG/twitter/meta-description 등 풍부한 메타 확보 → 대표이미지 포함 완전 카드
 *  - minimal : <title> 만 확보 (Cloudflare 챌린지 페이지 등) → 파비콘+제목+도메인 최소 카드
 *  - empty   : <title> 조차 없음 → 카드화 불가, 원본 링크 유지
 *  - failed  : 취득 실패(네트워크·DNS·SSRF 차단 등) → 원본 링크 유지
 *
 * (이 플러그인 도입 전 `sirsoft-ckeditor5` 다운스트림 포크가 쓰던 `ckeditor5_link_previews`
 *  테이블을 대체한다. 구 테이블 캐시는 7일 TTL 이라 폐기해도 무방 — 신규 조회 시 재생성된다.)
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('g7_superpack_link_previews', function (Blueprint $table) {
            $table->id()->comment('고유 ID');
            $table->char('url_hash', 64)->unique()->comment('정규화 URL 의 sha256 (조회 키)');
            $table->string('url', 2048)->comment('원본 URL');
            $table->string('status', 16)->default('ok')->comment('ok / minimal / empty / failed');
            $table->string('title', 512)->nullable()->comment('og:title 또는 <title>');
            $table->string('description', 1024)->nullable()->comment('og:description 또는 meta description');
            $table->string('image', 2048)->nullable()->comment('og:image (절대 URL)');
            $table->string('site_name', 255)->nullable()->comment('og:site_name');
            $table->string('favicon', 2048)->nullable()->comment('파비콘 절대 URL (최소 카드용)');
            $table->timestamp('fetched_at')->comment('마지막 취득 시각 (TTL 판정)');
            $table->timestamps();

            $table->index('fetched_at');
        });

        if (DB::getDriverName() === 'mysql') {
            Schema::table('g7_superpack_link_previews', function (Blueprint $table) {
                $table->comment('CKEditor 5 슈퍼팩 외부 링크 카드(OG 프리뷰) 캐시');
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('g7_superpack_link_previews');
    }
};
