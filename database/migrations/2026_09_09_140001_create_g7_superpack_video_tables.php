<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * CKEditor 5 슈퍼팩 — 로컬 동영상 업로드 테이블 2종.
 *
 *  - `g7_superpack_video_upload_sessions` : 진행 중인 청크 업로드 세션. `complete` 시
 *    조립·검증 후 삭제되며, 만료분은 스케줄 커맨드가 정리한다.
 *  - `g7_superpack_video_uploads` : 조립·검증 완료된 최종 파일 메타. 본문에는
 *    `/api/plugins/g7-ckeditor5-superpack/video/{public_id}` 링크로 참조되고,
 *    프론트 렌더러가 `<video>` 로 승격한다.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('g7_superpack_video_upload_sessions', function (Blueprint $table) {
            $table->id()->comment('고유 ID');
            $table->char('session_key', 40)->unique()->comment('세션 키 (서버 생성 랜덤, 청크 업로드 식별)');
            $table->string('original_name', 255)->comment('원본 파일명');
            $table->string('mime', 100)->comment('클라이언트 신고 MIME');
            $table->unsignedBigInteger('total_size')->comment('전체 바이트 수 (신고값)');
            $table->unsignedInteger('chunk_size')->comment('청크 크기 (바이트)');
            $table->unsignedInteger('total_chunks')->comment('전체 청크 수');
            $table->unsignedInteger('received_count')->default(0)->comment('수신 완료 청크 수');
            $table->string('status', 16)->default('uploading')->comment('uploading / assembling / done / failed');
            $table->unsignedBigInteger('uploaded_by')->nullable()->comment('업로드 사용자 ID');
            $table->timestamp('expires_at')->comment('세션 만료 시각 (정리 대상 판정)');
            $table->timestamps();

            $table->index('expires_at');
        });

        Schema::create('g7_superpack_video_uploads', function (Blueprint $table) {
            $table->id()->comment('고유 ID');
            $table->char('public_id', 32)->unique()->comment('공개 조회 키 (추측 불가, URL 에 노출)');
            $table->string('original_name', 255)->comment('원본 파일명');
            $table->string('mime', 100)->comment('검증된 MIME (video/mp4 등)');
            $table->unsignedBigInteger('size')->comment('최종 파일 바이트 수');
            $table->string('storage_disk', 50)->comment('저장 디스크 이름');
            $table->string('storage_path', 512)->comment('디스크 내 상대 경로 (카테고리 포함)');
            $table->unsignedBigInteger('uploaded_by')->nullable()->comment('업로드 사용자 ID');
            $table->timestamps();

            $table->index('created_at');
        });

        if (DB::getDriverName() === 'mysql') {
            Schema::table('g7_superpack_video_upload_sessions', function (Blueprint $table) {
                $table->comment('CKEditor 5 슈퍼팩 동영상 청크 업로드 세션');
            });
            Schema::table('g7_superpack_video_uploads', function (Blueprint $table) {
                $table->comment('CKEditor 5 슈퍼팩 동영상 업로드 파일 메타');
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('g7_superpack_video_upload_sessions');
        Schema::dropIfExists('g7_superpack_video_uploads');
    }
};
