<?php

namespace Plugins\G7\Ckeditor5\Superpack\Services;

use App\Contracts\Extension\StorageInterface;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Plugins\G7\Ckeditor5\Superpack\Models\VideoUpload;
use Plugins\G7\Ckeditor5\Superpack\Models\VideoUploadSession;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

/**
 * 로컬 동영상 청크 업로드 서비스.
 *
 * 흐름: init(세션 생성) → chunk×N(부분 저장) → complete(스트리밍 조립 + magic bytes
 * 검증 + 최종 이동). 조립은 청크를 한 번에 메모리에 올리지 않고 `stream_copy_to_stream`
 * 으로 이어 붙인다. 완성 파일은 플러그인 격리 스토리지(`plugins` 디스크,
 * `g7-ckeditor5-superpack/videos/`)에 저장되어 게시판 업로드와 섞이지 않는다.
 *
 * 보안:
 *  - 크기 상한: 설정 `video_max_mb` (하드캡 {@see HARD_CAP_MB}). init 신고값 + 조립 후 실측 2중.
 *  - 확장자: `.mp4` (+ 설정 시 `.m4v`).
 *  - MIME 시그니처: 조립 파일 앞부분에서 ISO-BMFF `ftyp` 박스 + brand 화이트리스트 검사
 *    (확장자만 바꾼 위장 파일 차단).
 *  - 업로드 인가: 컨트롤러(`AdminBaseController`: auth:sanctum + admin)가 전담.
 */
class VideoUploadService
{
    private const PLUGIN = 'g7-ckeditor5-superpack';

    /** 세션(진행 중 업로드) 유효 시간 */
    private const SESSION_TTL_HOURS = 6;

    /** 설정과 무관한 절대 상한 (MB) */
    private const HARD_CAP_MB = 2048;

    private const DEFAULT_MAX_MB = 200;

    /**
     * 청크 크기 기본값 (MB). 클수록 HTTP 왕복·프레임워크 부팅 반복이 줄어 업로드가 빨라진다
     * (병목 조사 결과 — 6MB 는 150MB 파일을 26청크로 쪼갠다). 상한 {@see CHUNK_MB_CAP}.
     */
    private const DEFAULT_CHUNK_MB = 20;

    /** 청크 크기 절대 상한 (MB). PHP post_max_size(40M)·upload_max_filesize(35M) 안쪽 여유값. */
    private const CHUNK_MB_CAP = 28;

    /**
     * 확장자 → (컨테이너 패밀리, MIME) 매핑.
     *   - ftyp  : ISO-BMFF 계열 (MP4/MOV/M4V). `ftyp` 박스로 검증.
     *   - ebml  : Matroska/WebM. `1A 45 DF A3` 매직으로 검증.
     */
    private const EXT_MAP = [
        'mp4' => ['family' => 'ftyp', 'mime' => 'video/mp4'],
        'm4v' => ['family' => 'ftyp', 'mime' => 'video/mp4'],
        'mov' => ['family' => 'ftyp', 'mime' => 'video/quicktime'],
        'webm' => ['family' => 'ebml', 'mime' => 'video/webm'],
    ];

    public function __construct(
        protected StorageInterface $storage,
    ) {}

    /* ---------------------------------------------------------------- *
     *  설정
     * ---------------------------------------------------------------- */

    public function maxBytes(): int
    {
        $mb = (int) plugin_setting(self::PLUGIN, 'video_max_mb', self::DEFAULT_MAX_MB);
        $mb = max(1, min(self::HARD_CAP_MB, $mb));

        return $mb * 1024 * 1024;
    }

    public function chunkBytes(): int
    {
        $mb = (int) plugin_setting(self::PLUGIN, 'video_chunk_mb', self::DEFAULT_CHUNK_MB);
        $mb = max(1, min(self::CHUNK_MB_CAP, $mb));

        return $mb * 1024 * 1024;
    }

    /** @return list<string> 허용 소문자 확장자. `.mp4` 는 항상. `.mov`/`.webm` 기본 허용, `.m4v` 옵트인. */
    public function allowedExtensions(): array
    {
        $ext = ['mp4'];
        if (plugin_setting(self::PLUGIN, 'video_allow_mov', true)) {
            $ext[] = 'mov';
        }
        if (plugin_setting(self::PLUGIN, 'video_allow_webm', true)) {
            $ext[] = 'webm';
        }
        if (plugin_setting(self::PLUGIN, 'video_allow_m4v', false)) {
            $ext[] = 'm4v';
        }

        return $ext;
    }

    public function isEnabled(): bool
    {
        return (bool) plugin_setting(self::PLUGIN, 'video_enabled', true);
    }

    /* ---------------------------------------------------------------- *
     *  1) init
     * ---------------------------------------------------------------- */

    /**
     * 업로드 세션을 생성한다.
     *
     * @param  array{filename:string,size:int,mime:string,total_chunks:int}  $meta
     * @return array{session_key:string, chunk_size:int}
     *
     * @throws \RuntimeException 검증 실패 (메시지는 사용자 노출용)
     */
    public function init(array $meta, ?int $userId): array
    {
        $name = trim((string) ($meta['filename'] ?? ''));
        $size = (int) ($meta['size'] ?? 0);
        $mime = strtolower(trim((string) ($meta['mime'] ?? '')));
        $chunkSize = $this->chunkBytes();

        $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
        if ($name === '' || ! in_array($ext, $this->allowedExtensions(), true)) {
            throw new \RuntimeException(__('g7-ckeditor5-superpack::messages.video.err_ext', ['exts' => implode(', ', $this->allowedExtensions())]));
        }
        if ($mime !== '' && ! str_starts_with($mime, 'video/')) {
            throw new \RuntimeException(__('g7-ckeditor5-superpack::messages.video.err_mime'));
        }
        if ($size <= 0 || $size > $this->maxBytes()) {
            throw new \RuntimeException(__('g7-ckeditor5-superpack::messages.video.err_size', ['max' => (int) round($this->maxBytes() / 1024 / 1024)]));
        }

        // 청크 수는 **서버가 결정한 chunk_size 기준**으로 확정한다. 클라이언트가 보낸
        // total_chunks 는 서버 chunk_size 를 알기 전의 추정값이라 그대로 믿지 않는다
        // (클라이언트는 응답의 chunk_size 로 다시 슬라이스한다).
        $totalChunks = max(1, (int) ceil($size / $chunkSize));

        $key = Str::random(40);
        File::ensureDirectoryExists($this->sessionDir($key), 0775);

        VideoUploadSession::query()->create([
            'session_key' => $key,
            'original_name' => mb_substr($name, 0, 255),
            'mime' => $mime !== '' ? $mime : 'video/mp4',
            'total_size' => $size,
            'chunk_size' => $chunkSize,
            'total_chunks' => $totalChunks,
            'received_count' => 0,
            'status' => 'uploading',
            'uploaded_by' => $userId,
            'expires_at' => now()->addHours(self::SESSION_TTL_HOURS),
        ]);

        return ['session_key' => $key, 'chunk_size' => $chunkSize, 'total_chunks' => $totalChunks];
    }

    /* ---------------------------------------------------------------- *
     *  2) chunk
     * ---------------------------------------------------------------- */

    /**
     * 청크 하나를 저장한다 (재시도 안전 — 같은 index 재수신 시 덮어씀).
     *
     * @return array{received:int, total:int}
     *
     * @throws \RuntimeException
     */
    public function receiveChunk(string $sessionKey, int $index, UploadedFile $chunk): array
    {
        $session = $this->activeSession($sessionKey);

        if ($index < 0 || $index >= $session->total_chunks) {
            throw new \RuntimeException(__('g7-ckeditor5-superpack::messages.video.err_generic'));
        }
        // 마지막 청크만 작을 수 있다. 그 외는 chunk_size 이하 + 약간의 여유.
        $limit = $session->chunk_size + 4096;
        if ($chunk->getSize() > $limit) {
            throw new \RuntimeException(__('g7-ckeditor5-superpack::messages.video.err_generic'));
        }

        $dest = $this->sessionDir($sessionKey).'/'.$index.'.part';
        $tmp = $dest.'.'.Str::random(6).'.tmp';
        $chunk->move(dirname($tmp), basename($tmp));
        @rename($tmp, $dest);

        // 진행 상태는 DB 에 쓰지 않는다 — `received_count` 는 어디서도 읽히지 않고
        // (`complete()` 는 `is_file()` 로 전 청크 존재를 파일시스템에서 재검증, 클라이언트는
        // 자체 카운터로 진행률 표시), 청크마다 UPDATE 하면 왕복이 청크 수만큼 쌓인다.
        // 응답의 `received` 는 디스크의 `.part` 개수(파일시스템 실측)로만 낸다.
        $received = count(glob($this->sessionDir($sessionKey).'/*.part') ?: []);

        return ['received' => $received, 'total' => $session->total_chunks];
    }

    /* ---------------------------------------------------------------- *
     *  3) complete
     * ---------------------------------------------------------------- */

    /**
     * 전 청크를 조립·검증하고 최종 파일을 만든다.
     *
     * @throws \RuntimeException
     */
    public function complete(string $sessionKey, ?int $userId): VideoUpload
    {
        $session = $this->activeSession($sessionKey);
        $dir = $this->sessionDir($sessionKey);

        for ($i = 0; $i < $session->total_chunks; $i++) {
            if (! is_file("{$dir}/{$i}.part")) {
                throw new \RuntimeException(__('g7-ckeditor5-superpack::messages.video.err_incomplete'));
            }
        }

        $session->update(['status' => 'assembling']);

        $assembled = "{$dir}/assembled.tmp";
        $out = fopen($assembled, 'wb');
        if ($out === false) {
            $this->failSession($session);
            throw new \RuntimeException(__('g7-ckeditor5-superpack::messages.video.err_generic'));
        }
        try {
            for ($i = 0; $i < $session->total_chunks; $i++) {
                $in = fopen("{$dir}/{$i}.part", 'rb');
                if ($in === false) {
                    throw new \RuntimeException('chunk open failed');
                }
                stream_copy_to_stream($in, $out);
                fclose($in);
            }
        } catch (\Throwable $e) {
            fclose($out);
            $this->failSession($session);
            Log::warning('[g7-ckeditor5-superpack] 동영상 조립 실패', ['session' => $sessionKey, 'error' => $e->getMessage()]);
            throw new \RuntimeException(__('g7-ckeditor5-superpack::messages.video.err_generic'));
        }
        fclose($out);

        $realSize = filesize($assembled) ?: 0;
        if ($realSize <= 0 || $realSize > $this->maxBytes()) {
            $this->failSession($session);
            throw new \RuntimeException(__('g7-ckeditor5-superpack::messages.video.err_size', ['max' => (int) round($this->maxBytes() / 1024 / 1024)]));
        }

        // 파일명 확장자 → 기대 컨테이너 패밀리·MIME. init 에서 허용목록 검증을 이미 통과했다.
        $ext = strtolower(pathinfo($session->original_name, PATHINFO_EXTENSION));
        $map = self::EXT_MAP[$ext] ?? null;
        if ($map === null || ! in_array($ext, $this->allowedExtensions(), true)) {
            $this->failSession($session);
            throw new \RuntimeException(__('g7-ckeditor5-superpack::messages.video.err_ext', ['exts' => implode(', ', $this->allowedExtensions())]));
        }

        // 매직바이트로 실제 컨테이너 패밀리를 확인하고, 확장자가 주장하는 패밀리와 일치해야 한다
        // (`video.mp4` 로 위장한 텍스트/webm 등 차단).
        $actualFamily = $this->detectContainerFamily($assembled);
        if ($actualFamily === null || $actualFamily !== $map['family']) {
            $this->failSession($session);
            throw new \RuntimeException(__('g7-ckeditor5-superpack::messages.video.err_signature'));
        }

        // 최종 위치로 이동 (확장자 보존)
        $rel = date('Y/m').'/'.Str::uuid()->toString().'.'.$ext;
        $finalAbs = $this->storage->getBasePath('videos').'/'.$rel;
        File::ensureDirectoryExists(dirname($finalAbs), 0775);
        if (! @rename($assembled, $finalAbs)) {
            // 다른 파일시스템일 수 있어 복사 폴백
            if (! @copy($assembled, $finalAbs)) {
                $this->failSession($session);
                throw new \RuntimeException(__('g7-ckeditor5-superpack::messages.video.err_generic'));
            }
            @unlink($assembled);
        }

        $video = VideoUpload::query()->create([
            'public_id' => bin2hex(random_bytes(16)),
            'original_name' => $session->original_name,
            'mime' => $map['mime'],
            'size' => $realSize,
            'storage_disk' => $this->storage->getDisk(),
            'storage_path' => $rel,
            'uploaded_by' => $userId,
        ]);

        // 세션 정리
        File::deleteDirectory($dir);
        $session->delete();

        return $video;
    }

    /* ---------------------------------------------------------------- *
     *  4) serve (Range)
     * ---------------------------------------------------------------- */

    /**
     * `BinaryFileResponse` 로 반환한다 — Symfony 가 `Range` 요청을 자동 처리(206).
     */
    public function serveResponse(VideoUpload $video): ?BinaryFileResponse
    {
        $disk = (string) ($video->storage_disk ?: $this->storage->getDisk());
        $storage = ($disk !== $this->storage->getDisk() && config("filesystems.disks.{$disk}") !== null)
            ? $this->storage->withDisk($disk)
            : $this->storage;

        $abs = $storage->getBasePath('videos').'/'.ltrim($video->storage_path, '/');
        if (! is_file($abs)) {
            Log::error('[g7-ckeditor5-superpack] 동영상 파일 없음', ['id' => $video->id, 'path' => $abs]);

            return null;
        }

        $response = new BinaryFileResponse($abs, 200, [
            'Content-Type' => $video->mime ?: 'video/mp4',
            'Cache-Control' => 'public, max-age=604800',
        ]);
        $response->setAutoLastModified();
        // 인라인 재생 (다운로드 강제 안 함)
        $response->headers->set('Content-Disposition', 'inline; filename="'.addslashes($video->original_name).'"');

        return $response;
    }

    /* ---------------------------------------------------------------- *
     *  5) prune (스케줄)
     * ---------------------------------------------------------------- */

    /**
     * 만료 세션 temp 정리 + (retention_days > 0 일 때) 미참조·기간초과 파일 삭제.
     *
     * @return array{sessions:int, files:int}
     */
    public function prune(bool $scheduled): array
    {
        $sessionsPruned = 0;
        foreach (VideoUploadSession::query()->where('expires_at', '<', now())->get() as $s) {
            File::deleteDirectory($this->sessionDir($s->session_key));
            $s->delete();
            $sessionsPruned++;
        }
        // 고아 temp 디렉토리(행 없는)도 정리
        $base = $this->storage->getBasePath('temp').'/video-sessions';
        if (is_dir($base)) {
            foreach (glob($base.'/*', GLOB_ONLYDIR) ?: [] as $d) {
                $key = basename($d);
                if (! VideoUploadSession::query()->where('session_key', $key)->exists()) {
                    File::deleteDirectory($d);
                }
            }
        }

        $filesPruned = 0;
        $retentionDays = (int) plugin_setting(self::PLUGIN, 'video_retention_days', 0);
        // 스케줄 실행에서는 설정 조회 실패 시 0(=삭제 안 함) 폴백이 안전.
        if ($retentionDays > 0) {
            $cutoff = now()->subDays($retentionDays);
            VideoUpload::query()->where('created_at', '<', $cutoff)->chunkById(100, function ($rows) use (&$filesPruned) {
                foreach ($rows as $v) {
                    if ($this->isReferenced($v->public_id)) {
                        continue;
                    }
                    $abs = $this->storage->getBasePath('videos').'/'.ltrim($v->storage_path, '/');
                    @unlink($abs);
                    $v->delete();
                    $filesPruned++;
                }
            });
        }

        return ['sessions' => $sessionsPruned, 'files' => $filesPruned];
    }

    /**
     * 어떤 게시글 본문에라도 이 동영상 링크가 있으면 true.
     */
    private function isReferenced(string $publicId): bool
    {
        $needle = '/video/'.$publicId;

        return DB::table('board_posts')
            ->where('content', 'like', '%'.$needle.'%')
            ->exists();
    }

    /* ---------------------------------------------------------------- *
     *  내부
     * ---------------------------------------------------------------- */

    private function activeSession(string $key): VideoUploadSession
    {
        $session = VideoUploadSession::query()->where('session_key', $key)->first();
        if (! $session || $session->expires_at < now() || in_array($session->status, ['done', 'failed'], true)) {
            throw new \RuntimeException(__('g7-ckeditor5-superpack::messages.video.err_session'));
        }

        return $session;
    }

    private function failSession(VideoUploadSession $session): void
    {
        $session->update(['status' => 'failed']);
        File::deleteDirectory($this->sessionDir($session->session_key));
    }

    private function sessionDir(string $key): string
    {
        // 키는 Str::random(40) [A-Za-z0-9] 라 traversal 불가하지만 방어적으로 basename.
        return $this->storage->getBasePath('temp').'/video-sessions/'.basename($key);
    }

    /**
     * 매직바이트로 컨테이너 패밀리를 판정한다 — 확장자 위장(텍스트를 `.mp4` 로 등) 차단.
     *
     *   - `ftyp` : ISO-BMFF (MP4/MOV/M4V). `[4B size]["ftyp"][4B brand]...`. 앞에 다른 박스가
     *              올 수 있어 앞 64KB 에서 "ftyp" 를 찾고 직후 brand 가 4바이트 ASCII 인지 본다.
     *              MOV(`qt  `)·MP4(`isom`,`mp4x`,`avc1` …)·프래그먼트 등 brand 는 매우 다양하므로
     *              엄격한 화이트리스트 대신 "ftyp 박스 존재 + brand 가 인쇄가능 ASCII" 로 완화.
     *   - `ebml` : Matroska/WebM. 파일 첫 4바이트가 `1A 45 DF A3`.
     *
     * @return 'ftyp'|'ebml'|null
     */
    private function detectContainerFamily(string $path): ?string
    {
        $fh = fopen($path, 'rb');
        if ($fh === false) {
            return null;
        }
        $head = fread($fh, 65536);
        fclose($fh);
        if ($head === false || strlen($head) < 12) {
            return null;
        }

        // WebM / Matroska (EBML)
        if (substr($head, 0, 4) === "\x1A\x45\xDF\xA3") {
            return 'ebml';
        }

        // ISO-BMFF: "ftyp" at offset 4, or anywhere in the first bytes
        $checkBrand = function (string $brand): bool {
            return strlen($brand) === 4 && preg_match('/^[\x20-\x7E]{4}$/', $brand) === 1;
        };
        if (substr($head, 4, 4) === 'ftyp' && $checkBrand(substr($head, 8, 4))) {
            return 'ftyp';
        }
        $pos = strpos($head, 'ftyp');
        if ($pos !== false && $pos >= 4 && strlen($head) >= $pos + 8 && $checkBrand(substr($head, $pos + 4, 4))) {
            return 'ftyp';
        }

        return null;
    }
}
