<?php

namespace Plugins\G7\Ckeditor5\Superpack;

use App\Enums\ExtensionOwnerType;
use App\Extension\AbstractPlugin;
use App\Extension\Helpers\ExtensionMenuSyncHelper;
use Plugins\G7\Ckeditor5\Superpack\Http\Middleware\CorrectDownloadFilenameExtension;
use Plugins\G7\Ckeditor5\Superpack\Listeners\ImagePasteWebpConversionListener;

/**
 * CKEditor 5 슈퍼팩 플러그인 (g7-ckeditor5-superpack)
 *
 * CKEditor 5(`sirsoft-ckeditor5`)로 작성한 게시글 본문에 기능 7가지를 더한다.
 *
 *  1. **SNS 링크 자동 임베드** — 본문에 단독으로 붙여넣은 YouTube·X(Twitter)·Instagram·TikTok
 *     링크를 방문자 화면에서 각 플랫폼 임베드로 치환한다.
 *  2. **외부 링크 카드화** — 임베드 대상이 아닌 일반 외부 링크를 대표이미지+제목+요약+도메인
 *     카드(OG 카드) 또는 파비콘+제목+도메인 최소 카드로 렌더한다. OG 메타는 서버 엔드포인트
 *     `GET /api/plugins/g7-ckeditor5-superpack/link-preview` 가 SSRF 방어와 함께 대신 가져온다.
 *  3. **로컬 동영상 업로드** — 에디터 위 "동영상 업로드" 버튼으로 MP4/MOV/WebM 을 청크 업로드하고,
 *     본문에는 순수 링크만 저장한 뒤 방문자 화면에서 `<video controls>` 플레이어로 승격한다.
 *  4. **마크다운 자동 변환** — 저장된 본문의 `##`·`**굵게**` 같은 마크다운 기호를 방문자 화면에서
 *     실제 서식으로 바꾼다(원문 저장은 그대로, 편집기 안에서는 실행 안 함).
 *  5. **에디터 스타일** — 게시글 본문(작성 화면+방문자 화면)의 기본 글자크기·줄간격을 전역
 *     설정으로 조정한다. 게시글 본문은 `.ck-content.prose` 셀렉터로 적용되며, 댓글은
 *     `.ck-content`/`prose` 경로를 타지 않고 `g7-comment-editor`가 클라이언트에서 승격시킨
 *     `p.text-gray-700.dark:text-gray-300` 요소이므로 기본적으로 구조적으로 분리되고,
 *     "댓글에도 적용" 옵션으로 선택적으로 확장할 수 있다.
 *  6. **이미지 복붙** — 타 사이트에서 이미지를 우클릭 복사/드래그해 게시글 본문 에디터에
 *     붙여넣으면(클립보드에 실제 이미지 바이너리가 있는 경우) 자동으로 서버에 업로드하고
 *     본문에 삽입한다. 재호스팅(외부 URL 재요청) 방식이 아니라 클립보드가 이미 들고 있는
 *     바이너리를 CKEditor5 표준 `uploadImage` 커맨드로 그대로 넘기는 방식이라 사이트별
 *     성공률 편차가 없다(과거 버전의 URL 재호스팅 방식은 안정성 문제로 폐기됨, 아래
 *     "참고" 항목). 부가로 PNG→WebP 자동 변환 옵션을 함께 제공한다 —
 *     `ImagePasteWebpConversionListener`(필터 훅 8개 구독) +
 *     `ImagePasteWebpConverter`(Imagick 기반 인코딩 엔진) +
 *     `CorrectDownloadFilenameExtension`(다운로드 파일명 확장자 보정 미들웨어)
 *     세 클래스가 이 플러그인 안에서 완결돼 있다 — 이 플러그인만 설치해도 두 토글
 *     (`imagepaste_enabled`/`imagepaste_webp_enabled`) 전부 실제로 동작한다(v1.2.1
 *     이전에는 변환 엔진이 g7 코어에 직접 패치돼 있어 이 플러그인만 다른 사이트에
 *     설치하면 WebP 변환 체크박스가 조용히 무동작이었다 — v1.2.1에서 전부 이 플러그인
 *     쪽으로 옮기며 코어 패치를 완전히 제거했다).
 *  7. **코드 서식** — 게시글 본문 에디터 툴바에 코드·코드 블록 버튼을 더하고(설치된 CKEditor
 *     빌드의 Code·CodeBlock), 저장된 코드(툴바 코드와 마크다운 코드)를 같은 모양으로 보여 주며,
 *     글 보기 화면의 코드 블록에 복사 버튼을 단다.
 *
 * 아키텍처: 프론트 렌더 로직은 `loading.strategy = global` 로 전 페이지에 로드되는
 * `dist/js/plugin.iife.js` 가 `.ck-content` 를 자체 스캔(+MutationObserver)해 수행한다.
 * 이 파일은 `resources/js/src/` 의 번호 붙은 조각(코어·기능 섹션·부팅)을 이어 붙인 결과다
 * (구조와 새 섹션 추가 절차는 README "Development" 절).
 * 편집 화면의 동영상 업로드 버튼·미디어 라이브러리·에디터 스타일 마커·이미지 복붙
 * 캡처 리스너는 `element.ckeditorInstance` 로 얹는다. CKEditor 본체(`sirsoft-ckeditor5`)는
 * 손대지 않는다 — 저장 데이터는 순수 `<a href>` 링크·원문 텍스트(이미지 복붙만 예외 —
 * `<img>` 자체를 표준 업로드 파이프라인으로 저장)이며, 이 플러그인이 방문자 화면에서만
 * 임베드/카드/플레이어/서식으로 승격한다.
 *
 * 서버 측(이미지 복붙 한정)도 g7 코어·`sirsoft-ckeditor5`·벤더 모듈(`sirsoft-board`/
 * `sirsoft-page`)을 전혀 수정하지 않는다 — `getHookListeners()`가 그 쪽들이 이미
 * 제공하는 필터 훅(`*.filter_upload_file`)을 구독해 변환을 끼워 넣고,
 * `getMiddleware()`가 응답 헤더만 보고 다운로드 파일명을 보정한다. 리사이즈
 * (`App\Support\ImageResizer::resizeInPlace()`)만 g7 코어의 정식 업스트림 기능
 * (v7.0.6+)이라 그대로 쓴다 — 이 플러그인이 재구현하지 않는다.
 *
 * 설정은 관리자 화면(`/admin/plugins/g7-ckeditor5-superpack/settings`)의 탭 7개
 * (SNS 임베드 / 외부 링크 카드화 / 로컬 동영상 업로드 / 마크다운 자동 변환 /
 * 에디터 스타일 / 이미지 복붙 / 코드 서식)에서 기능별로 조정한다. 각 기능을 끄면 해당 동작을 건너뛴다.
 * (코드 서식 탭은 에디터 버튼만 켜고 끈다. 저장된 코드의 표시 스타일은 항상 적용된다.)
 *
 * 참고(과거 이력): "이미지 복붙허용"이라는 이름으로 외부 이미지 URL을 서버가 대신
 * 재요청해 재호스팅하는 방식이 2026-09-11에 먼저 시도됐으나, 사이트별로 결과가
 * 제각각임이 확인되어(정상 사이트는 성공, CORS 차단·조용한 실패·원천 차단 등 사이트마다
 * 다른 실패 양상) 안정성 미확보로 같은 날 롤백됐다. 위 6번 "이미지 복붙" 기능은 그
 * 재설계 결과물로, 재호스팅이 아니라 클립보드가 이미 보유한 바이너리만 사용하는 전혀
 * 다른(더 단순하고 안정적인) 방식이다.
 */
class Plugin extends AbstractPlugin
{
    /**
     * 플러그인 메타데이터 반환
     *
     * @return array 메타데이터
     */
    public function getMetadata(): array
    {
        return [
            'author' => 'William Cho',
            'license' => 'MIT',
            'keywords' => ['ckeditor5', 'oembed', 'sns', 'youtube', 'twitter', 'instagram', 'tiktok', 'link-preview', 'og-card'],
        ];
    }

    /**
     * 플러그인 설정 스키마 반환
     *
     * 일곱 탭으로 나뉜다:
     *  - `sns_*`        : SNS 링크 임베드 (마스터 토글 + 플랫폼별 토글 + Shorts 비율)
     *  - `linkcard_*`   : 외부 링크 카드화 (마스터 토글 + 최소 카드 토글 + 이미지 크기 + 캐시 TTL 2종)
     *  - `video_*`      : 로컬 동영상 업로드 (마스터 토글 + 최대 크기 + 청크 크기 + 확장자 토글 + 보관기간)
     *  - `md_*`         : 마크다운 자동 변환 (마스터 토글 + 요소별 토글 9종)
     *  - `editor_*`     : 에디터 스타일 (마스터 토글 + 글자크기 + 줄간격 + 댓글에도 적용)
     *  - `imagepaste_*` : 이미지 복붙 (클립보드 자동 업로드 토글 + PNG→WebP 변환 토글,
     *                     둘은 서로 독립 — 둘 다 이 플러그인 안에서 완결됨, 클래스 상단 docblock 참고)
     *  - `codeformat_*` : 코드 서식 (본문 에디터 인라인 코드·코드 블록 버튼 토글. 저장된 코드 표시는 항상 켜짐)
     *
     * @return array 설정 스키마
     */
    public function getSettingsSchema(): array
    {
        return [
            // ---- 탭 1: SNS 링크 임베드 ----
            'sns_enabled' => $this->booleanSetting(
                true,
                ['ko' => 'SNS 링크 임베드 사용', 'en' => 'Enable SNS Link Embeds'],
                ['ko' => '끄면 SNS 링크도 임베드되지 않고 일반 링크로 남습니다.', 'en' => 'When off, SNS links are left as plain links instead of being embedded.'],
            ),
            'sns_youtube' => $this->booleanSetting(
                true,
                ['ko' => 'YouTube', 'en' => 'YouTube'],
                ['ko' => 'YouTube 영상·Shorts 링크를 재생 가능한 임베드로 표시합니다.', 'en' => 'Render YouTube video and Shorts links as playable embeds.'],
            ),
            'sns_twitter' => $this->booleanSetting(
                true,
                ['ko' => 'X (Twitter)', 'en' => 'X (Twitter)'],
                ['ko' => 'X(구 Twitter) 게시물 링크를 임베드로 표시합니다.', 'en' => 'Render X (formerly Twitter) post links as embeds.'],
            ),
            'sns_instagram' => $this->booleanSetting(
                true,
                ['ko' => 'Instagram', 'en' => 'Instagram'],
                ['ko' => 'Instagram 게시물·릴스 링크를 임베드로 표시합니다.', 'en' => 'Render Instagram post and Reels links as embeds.'],
            ),
            'sns_tiktok' => $this->booleanSetting(
                true,
                ['ko' => 'TikTok', 'en' => 'TikTok'],
                ['ko' => 'TikTok 영상 링크를 임베드로 표시합니다.', 'en' => 'Render TikTok video links as embeds.'],
            ),
            'sns_shorts_ratio' => [
                'type' => 'enum',
                'options' => ['9/16', '1/1', '4/5', '16/9'],
                'default' => '9/16',
                'label' => [
                    'ko' => 'YouTube Shorts 세로 비율',
                    'en' => 'YouTube Shorts Aspect Ratio',
                ],
                'hint' => [
                    'ko' => 'Shorts 임베드 박스의 가로:세로 비율입니다. URL 만으로 실제 영상 방향을 알 수 없어, 세로가 아닌 Shorts 는 위아래 여백이 생깁니다.',
                    'en' => 'Width:height ratio of the Shorts embed box. The real orientation cannot be known from the URL alone, so non-vertical Shorts get letterboxed.',
                ],
                'required' => false,
            ],

            // ---- 탭 2: 외부 링크 카드화 ----
            'linkcard_enabled' => $this->booleanSetting(
                true,
                ['ko' => '외부 링크 카드화 사용', 'en' => 'Enable External Link Cards'],
                ['ko' => '끄면 일반 외부 링크는 카드로 바뀌지 않고 링크 그대로 남습니다.', 'en' => 'When off, plain external links are left as-is instead of being turned into cards.'],
            ),
            'linkcard_minimal_enabled' => $this->booleanSetting(
                true,
                ['ko' => '최소 카드 표시', 'en' => 'Show Minimal Cards'],
                ['ko' => 'OG 메타를 얻지 못했지만 제목은 확보한 경우(예: Cloudflare 챌린지 페이지) 파비콘+제목+도메인 최소 카드를 보여줍니다. 끄면 이런 링크는 원본 링크 그대로 둡니다.', 'en' => 'When OG metadata is unavailable but a title was obtained (e.g. a Cloudflare challenge page), show a favicon + title + domain minimal card. When off, such links are left as-is.'],
            ),
            'linkcard_image_size' => [
                'type' => 'integer',
                'default' => 168,
                'min' => 80,
                'max' => 400,
                'label' => [
                    'ko' => '카드 대표이미지 크기 (px)',
                    'en' => 'Card Thumbnail Size (px)',
                ],
                'hint' => [
                    'ko' => '완전 카드(OG 카드) 대표이미지의 정사각 한 변 크기입니다. (80 ~ 400)',
                    'en' => 'Square side length of the full (OG) card thumbnail. (80 ~ 400)',
                ],
                'required' => false,
            ],
            'linkcard_ttl_ok_days' => [
                'type' => 'integer',
                'default' => 7,
                'min' => 1,
                'max' => 90,
                'label' => [
                    'ko' => '성공 캐시 보존기간 (일)',
                    'en' => 'Success Cache TTL (days)',
                ],
                'hint' => [
                    'ko' => '카드 생성에 성공한 링크(ok·minimal)의 메타를 며칠간 재사용할지입니다. 이 기간이 지나면 다음 조회 때 다시 가져옵니다. (1 ~ 90)',
                    'en' => 'How many days to reuse metadata for links that produced a card (ok / minimal). After this it is re-fetched on the next view. (1 ~ 90)',
                ],
                'required' => false,
            ],
            'linkcard_ttl_fail_hours' => [
                'type' => 'integer',
                'default' => 24,
                'min' => 1,
                'max' => 720,
                'label' => [
                    'ko' => '실패 캐시 보존기간 (시간)',
                    'en' => 'Failure Cache TTL (hours)',
                ],
                'hint' => [
                    'ko' => '카드화에 실패한 링크(failed·empty)를 몇 시간 뒤에 다시 시도할지입니다. 짧게 두면 일시적 실패를 빨리 회복하지만 상대 서버 조회가 잦아집니다. (1 ~ 720)',
                    'en' => 'How many hours before retrying links that failed to become a card (failed / empty). Shorter recovers from transient failures faster but hits the remote server more often. (1 ~ 720)',
                ],
                'required' => false,
            ],

            // ---- 탭 3: 로컬 동영상 업로드 ----
            'video_enabled' => $this->booleanSetting(
                true,
                ['ko' => '로컬 동영상 업로드 사용', 'en' => 'Enable Local Video Upload'],
                ['ko' => '끄면 편집 화면의 "동영상 업로드" 버튼이 사라지고, 이미 올린 동영상도 재생되지 않고 링크로 표시됩니다.', 'en' => 'When off, the "Upload video" button disappears from the editor and existing videos show as links instead of players.'],
            ),
            'video_max_mb' => [
                'type' => 'integer',
                'default' => 200,
                'min' => 1,
                'max' => 2048,
                'label' => [
                    'ko' => '최대 파일 크기 (MB)',
                    'en' => 'Max File Size (MB)',
                ],
                'hint' => [
                    'ko' => '업로드 가능한 MP4 한 개의 최대 크기입니다. 디스크 용량 보호를 위해 무제한은 불가하며 상한은 2048MB 입니다. (1 ~ 2048)',
                    'en' => 'Maximum size of a single uploadable MP4. Unlimited is not allowed (disk protection); the hard cap is 2048 MB. (1 ~ 2048)',
                ],
                'required' => false,
            ],
            'video_chunk_mb' => [
                'type' => 'integer',
                'default' => 20,
                'min' => 1,
                'max' => 28,
                'label' => [
                    'ko' => '청크 크기 (MB)',
                    'en' => 'Chunk Size (MB)',
                ],
                'hint' => [
                    'ko' => '대용량 파일을 잘라 보내는 조각의 크기입니다. 서버 업로드 한도(기본 35MB)보다 작아야 합니다. 값이 클수록 왕복 요청 수가 줄어 업로드가 빨라집니다. (1 ~ 28, 권장 20)',
                    'en' => 'Size of the pieces a large file is split into. Must be below the server upload limit (35 MB by default). Larger means fewer round-trips and a faster upload. (1 ~ 28, recommended 20)',
                ],
                'required' => false,
            ],
            'video_allow_mov' => $this->booleanSetting(
                true,
                ['ko' => '.mov 허용 (QuickTime · 아이폰 촬영본)', 'en' => 'Allow .mov (QuickTime / iPhone)'],
                ['ko' => 'QuickTime `.mov` 를 받습니다. MP4 와 같은 ISO 컨테이너라 시그니처는 통과하지만, 아이폰 최신 촬영본은 HEVC(H.265) 코덱이라 Firefox·구형 Chrome 에서 재생이 안 될 수 있습니다(트랜스코딩 없이는 해결 불가 — 이번 범위 밖).', 'en' => 'Accepts QuickTime `.mov`. Same ISO container as MP4 so the signature passes, but recent iPhone captures use the HEVC (H.265) codec which will not play in Firefox and older Chrome (not solvable without transcoding — out of scope here).'],
            ),
            'video_allow_webm' => $this->booleanSetting(
                true,
                ['ko' => '.webm 허용 (웹 표준)', 'en' => 'Allow .webm (web standard)'],
                ['ko' => 'WebM `.webm` 를 받습니다. EBML 시그니처를 별도로 검사합니다. VP8/VP9/AV1 코덱은 대부분의 최신 브라우저에서 재생됩니다(Safari 는 버전에 따라 제한).', 'en' => 'Accepts WebM `.webm`. Checked against the EBML signature. VP8/VP9/AV1 codecs play in most modern browsers (Safari support varies by version).'],
            ),
            'video_allow_m4v' => $this->booleanSetting(
                false,
                ['ko' => '.m4v 확장자도 허용', 'en' => 'Also allow .m4v'],
                ['ko' => '기본은 꺼짐. 켜면 `.m4v` 도 받습니다 (MP4 와 동일 컨테이너 시그니처 검사).', 'en' => 'Off by default. Turn on to also accept `.m4v` (same container signature check as MP4).'],
            ),
            'video_retention_days' => [
                'type' => 'integer',
                'default' => 0,
                'min' => 0,
                'max' => 3650,
                'label' => [
                    'ko' => '자동 삭제 보관기간 (일, 0 = 무기한)',
                    'en' => 'Auto-delete Retention (days, 0 = keep forever)',
                ],
                'hint' => [
                    'ko' => '기본 0 — 자동 삭제하지 않습니다. 1 이상으로 두면 매일, 어느 게시글 본문에서도 참조되지 않고 업로드 후 이 기간이 지난 동영상 파일을 삭제합니다. 게시글에서 쓰이는 동영상은 지우지 않습니다. (0 ~ 3650)',
                    'en' => 'Default 0 — never auto-delete. Set 1+ to delete daily any video file that is not referenced by any post body and is older than this. Videos in use are never removed. (0 ~ 3650)',
                ],
                'required' => false,
            ],

            // ---- 탭 4: 마크다운 자동 변환 ----
            'md_enabled' => $this->booleanSetting(
                true,
                ['ko' => '마크다운 자동 변환 사용', 'en' => 'Enable Markdown Auto-conversion'],
                ['ko' => '마크다운 문법(`### 제목`, `**굵게**`, `- 목록` 등)으로 붙여넣은 본문을 방문자 화면에서 실제 서식으로 변환해 보여줍니다. 저장된 원본 텍스트는 그대로 둡니다. 끄면 기호가 그대로 노출됩니다.', 'en' => 'Renders body text pasted as Markdown (`### heading`, `**bold**`, `- list`, …) as real formatting on the visitor page. The stored source text is left untouched. When off, the marks are shown literally.'],
            ),
            'md_heading' => $this->booleanSetting(
                true,
                ['ko' => '제목 (`#`, `##`, `###`)', 'en' => 'Headings (`#`, `##`, `###`)'],
                ['ko' => '줄 전체가 `#`~`###` + 공백 + 내용 형태일 때만 h1~h3 로 변환합니다.', 'en' => 'Converts a line to h1–h3 only when the whole line is `#`–`###` + space + content.'],
            ),
            'md_bold' => $this->booleanSetting(
                true,
                ['ko' => '굵게 (`**텍스트**`)', 'en' => 'Bold (`**text**`)'],
                ['ko' => '`**...**` 로 감싼 부분을 굵게. 양끝이 공백이 아니어야 합니다.', 'en' => 'Text wrapped in `**...**` becomes bold (no spaces immediately inside).'],
            ),
            'md_italic' => $this->booleanSetting(
                false,
                ['ko' => '기울임 (`*텍스트*`) — 오탐 위험, 기본 꺼짐', 'en' => 'Italic (`*text*`) — false-positive prone, off by default'],
                ['ko' => '`*...*` 를 기울임으로. 별표(*)는 강조·각주 등으로도 흔히 쓰여 오탐 위험이 있어 기본은 꺼져 있습니다.', 'en' => '`*...*` becomes italic. Asterisks are commonly used for emphasis/footnotes too, so this is off by default.'],
            ),
            'md_list' => $this->booleanSetting(
                true,
                ['ko' => '목록 (`- 항목`, `1. 항목`)', 'en' => 'Lists (`- item`, `1. item`)'],
                ['ko' => '`- `/`* `/`+ ` 또는 `1. ` 으로 시작하는 줄이 **2줄 이상 연속**일 때만 목록으로 변환합니다(단일 줄은 무시).', 'en' => 'Converts to a list only when 2+ consecutive lines start with `- `/`* `/`+ ` or `1. ` (a single line is ignored).'],
            ),
            'md_link' => $this->booleanSetting(
                true,
                ['ko' => '링크 (`[텍스트](URL)`)', 'en' => 'Links (`[text](URL)`)'],
                ['ko' => '`[텍스트](http…)` 를 링크로. http(s) 절대 URL 만 대상입니다. 라벨이 붙은 링크는 SNS 임베드/카드 대상이 되지 않습니다.', 'en' => '`[text](http…)` becomes a link (http(s) absolute URLs only). A labelled link is not turned into an SNS embed/card.'],
            ),
            'md_code' => $this->booleanSetting(
                true,
                ['ko' => '코드 (`` `인라인` ``, ``` 블록)', 'en' => 'Code (`` `inline` ``, ``` block)'],
                ['ko' => '백틱으로 감싼 인라인 코드와, 단독 ``` 줄로 여닫는 코드블록을 변환합니다.', 'en' => 'Converts backtick-wrapped inline code and fenced code blocks opened/closed by a lone ``` line.'],
            ),
            'md_quote' => $this->booleanSetting(
                true,
                ['ko' => '인용구 (`> 인용`)', 'en' => 'Blockquote (`> quote`)'],
                ['ko' => '`> ` 로 시작하는 줄을 인용구로 변환합니다. 연속 줄은 한 인용구로 묶입니다.', 'en' => 'Converts lines starting with `> ` to a blockquote; consecutive lines are merged into one.'],
            ),
            'md_table' => $this->booleanSetting(
                true,
                ['ko' => '표 (`| 제목 | 제목 |` + `|---|---|`)', 'en' => 'Tables (`| head | head |` + `|---|---|`)'],
                ['ko' => '헤더 행 바로 다음 줄이 열 수가 같은 구분 행(`|---|`)일 때만 표로 변환합니다. 첫 행은 헤더 셀, 셀 안의 굵게·링크·코드도 변환합니다. 열 정렬 표기(`:---`, `---:`)는 무시합니다.', 'en' => 'Converts to a table only when the header row is immediately followed by a delimiter row (`|---|`) with the same column count. The first row becomes header cells; bold/links/code inside cells are converted too. Column alignment marks (`:---`, `---:`) are ignored.'],
            ),
            'md_hr' => $this->booleanSetting(
                true,
                ['ko' => '구분선 (`---`)', 'en' => 'Horizontal rule (`---`)'],
                ['ko' => '줄 전체가 `---`/`***`/`___`(3개 이상)인 줄을 구분선으로 표시합니다(에디터 툴바 설정과 무관). 끄면 원문 글자 그대로 표시합니다.', 'en' => 'Shows a whole-line `---`/`***`/`___` (3+) as a horizontal rule (regardless of the editor toolbar). When off, the line is shown as literal text.'],
            ),
            // ---- 탭 5: 에디터 스타일 ----
            'editor_style_enabled' => $this->booleanSetting(
                false,
                ['ko' => '에디터 스타일 사용', 'en' => 'Enable Editor Style'],
                ['ko' => '게시글 본문의 기본 글자크기·줄간격을 아래 값으로 바꿉니다. 끄면 sirsoft-ckeditor5 기본값 그대로 표시됩니다.', 'en' => "Changes the post body's base font size and line height to the values below. When off, the sirsoft-ckeditor5 default is shown."],
            ),
            'editor_font_size' => [
                'type' => 'integer',
                'default' => 16,
                'min' => 12,
                'max' => 28,
                'label' => [
                    'ko' => '기본 글자크기 (px)',
                    'en' => 'Base Font Size (px)',
                ],
                'hint' => [
                    'ko' => '게시글 본문(작성 화면·게시글 화면 양쪽)의 기본 글자크기입니다. 특정 글자에 직접 크기를 지정한 부분(에디터의 글자크기 도구로 개별 지정한 텍스트)은 이 값의 영향을 받지 않습니다. (12 ~ 28)',
                    'en' => "Base font size for the post body (both the writing screen and the published post). Text with an explicit size set via the editor's own font-size tool is unaffected. (12 - 28)",
                ],
                'required' => false,
            ],
            'editor_line_height' => [
                'type' => 'enum',
                'options' => ['1.2', '1.4', '1.6', '1.8', '2.0'],
                'default' => '1.6',
                'label' => [
                    'ko' => '줄간격 (배수)',
                    'en' => 'Line Height (multiplier)',
                ],
                'hint' => [
                    'ko' => '본문 줄과 줄 사이 간격입니다. 1.6이 기본적으로 읽기 편한 값입니다.',
                    'en' => 'Spacing between lines in the body. 1.6 is a comfortable default for reading.',
                ],
                'required' => false,
            ],
            'editor_apply_to_comments' => $this->booleanSetting(
                false,
                ['ko' => '댓글에도 동일하게 적용', 'en' => 'Also Apply to Comments'],
                ['ko' => '켜면 댓글 영역에도 같은 글자크기·줄간격이 적용됩니다. sirsoft-basic 댓글 스타일과 다르게 보일 수 있습니다.', 'en' => 'When on, the same font size and line height are also applied to comments. This may look different from the default sirsoft-basic comment style.'],
            ),

            // ---- 탭 6: 이미지 복붙 ----
            'imagepaste_enabled' => $this->booleanSetting(
                true,
                ['ko' => '클립보드 이미지 자동 업로드', 'en' => 'Auto-upload Pasted Clipboard Images'],
                ['ko' => '타 사이트에서 이미지를 우클릭으로 복사하거나 드래그해서 게시글 본문 에디터에 붙여넣으면 자동으로 서버에 업로드되고 렌더링됩니다. 끄면 이 플러그인이 추가한 클립보드 붙여넣기 가로채기가 모두 비활성화되고 sirsoft-ckeditor5 기본 동작으로 돌아갑니다 — 스크린샷 붙여넣기는 이 설정과 무관하게 계속 동작하지만, 업로드 중 제출 방지 안전장치는 이 설정을 끄면 함께 빠집니다.', 'en' => "Right-click-copying or dragging an image from another site and pasting it into the post body editor uploads it to the server automatically. When off, this plugin's paste interception is fully disabled and sirsoft-ckeditor5's default behavior takes over — pasting a real screenshot still works regardless of this setting, but the safeguard against submitting while an upload is in progress is disabled along with it."],
            ),
            'imagepaste_webp_enabled' => $this->booleanSetting(
                true,
                ['ko' => '업로드 이미지 PNG→WebP 자동 변환', 'en' => 'Auto-convert Uploaded PNG Images to WebP'],
                ['ko' => '클립보드 붙여넣기 시 브라우저가 이미지를 PNG로 재구성해 용량이 커지는 문제를 줄이기 위해, 서버에 저장할 때 PNG를 WebP로 다시 압축합니다(무손실 우선, 필요 시 고품질 손실 압축, 원본보다 커지면 자동으로 원본을 그대로 둡니다). 위 클립보드 붙여넣기 설정을 꺼도 이 설정은 별개로 동작합니다.', 'en' => "To offset browsers re-encoding pasted images as PNG (which inflates file size), PNG uploads are re-compressed to WebP on the server (lossless first, falling back to high-quality lossy compression if needed, automatically keeping the original if the result would be larger). This works independently of the clipboard-paste setting above."],
            ),

            // ---- 탭 7: 코드 서식 ----
            'codeformat_enabled' => $this->booleanSetting(
                true,
                ['ko' => '코드 서식 버튼 사용', 'en' => 'Enable Code Formatting Buttons'],
                ['ko' => '켜면 게시글 본문 에디터 툴바에 인라인 코드·코드 블록 버튼이 생깁니다. 끄면 버튼만 사라지고, 이미 작성한 글의 코드는 그대로 보입니다.', 'en' => 'When on, the post editor toolbar gets inline code and code block buttons. When off, only the buttons go away; code in existing posts still displays as before.'],
            ),
        ];
    }

    /**
     * 플러그인 설정 기본값 반환
     *
     * @return array 기본 설정값
     */
    public function getConfigValues(): array
    {
        return [
            'sns_enabled' => true,
            'sns_youtube' => true,
            'sns_twitter' => true,
            'sns_instagram' => true,
            'sns_tiktok' => true,
            'sns_shorts_ratio' => '9/16',
            'linkcard_enabled' => true,
            'linkcard_minimal_enabled' => true,
            'linkcard_image_size' => 168,
            'linkcard_ttl_ok_days' => 7,
            'linkcard_ttl_fail_hours' => 24,
            'video_enabled' => true,
            'video_max_mb' => 200,
            'video_chunk_mb' => 20,
            'video_allow_mov' => true,
            'video_allow_webm' => true,
            'video_allow_m4v' => false,
            'video_retention_days' => 0,
            'md_enabled' => true,
            'md_heading' => true,
            'md_bold' => true,
            'md_italic' => false,
            'md_list' => true,
            'md_link' => true,
            'md_code' => true,
            'md_quote' => true,
            'md_table' => true,
            'md_hr' => true,
            'editor_style_enabled' => false,
            'editor_font_size' => 16,
            'editor_line_height' => '1.6',
            'editor_apply_to_comments' => false,
            'imagepaste_enabled' => true,
            'imagepaste_webp_enabled' => true,
            'codeformat_enabled' => true,
        ];
    }

    /**
     * boolean 설정 스키마 항목 헬퍼
     *
     * @param  bool  $default  기본값
     * @param  array<string, string>  $label  다국어 라벨
     * @param  array<string, string>  $hint  다국어 설명
     * @return array<string, mixed>
     */
    private function booleanSetting(bool $default, array $label, array $hint): array
    {
        return [
            'type' => 'boolean',
            'default' => $default,
            'label' => $label,
            'hint' => $hint,
            'required' => false,
        ];
    }

    /**
     * 관리자 메뉴 정의
     *
     * @return array<int, array<string, mixed>>
     */
    public function getAdminMenus(): array
    {
        return [
            [
                'name' => ['ko' => 'CKEditor 5 슈퍼팩', 'en' => 'CKEditor 5 Superpack'],
                'slug' => 'g7-ckeditor5-superpack-settings',
                'url' => '/admin/plugins/g7-ckeditor5-superpack/settings',
                'icon' => 'fas fa-photo-film',
                'order' => 61,
            ],
        ];
    }

    /**
     * 플러그인이 관리하는 동적 테이블 목록 반환
     *
     * @return array 테이블명 배열
     */
    public function getDynamicTables(): array
    {
        return [
            'g7_superpack_link_previews',
            'g7_superpack_video_uploads',
            'g7_superpack_video_upload_sessions',
        ];
    }

    /**
     * 플러그인 스케줄 목록 반환
     *
     * 만료된 동영상 업로드 세션(임시 청크)은 항상 정리한다. 완성 파일 삭제는 설정
     * `video_retention_days` 가 0 보다 클 때만 커맨드 내부에서 수행한다(옵트인).
     *
     * 링크 카드 캐시는 TTL 이 지난 행과 최대 행 수 초과분을 매일 지운다. 동영상 정리와
     * 겹치지 않도록 30분 뒤(cron `30 0 * * *`)에 돈다.
     *
     * @return array<int, array<string, string>>
     */
    public function getSchedules(): array
    {
        return [
            [
                'command' => 'g7-ckeditor5-superpack:prune-videos --scheduled',
                'schedule' => 'daily',
                'description' => '만료된 동영상 업로드 세션 + (옵트인 시) 미참조 동영상 파일 정리',
            ],
            [
                'command' => 'g7-ckeditor5-superpack:prune-link-previews --scheduled',
                'schedule' => '30 0 * * *',
                'description' => 'TTL 이 지난 외부 링크 카드 캐시 + 최대 행 수 초과분 정리',
            ],
        ];
    }

    /**
     * 플러그인 훅 리스너 목록 반환.
     *
     * `ImagePasteWebpConversionListener` 하나가 "이미지 복붙" 탭의
     * `imagepaste_webp_enabled` 설정을 8개 이미지 업로드 경로(게시글 에디터·g7
     * 코어 첨부 2종·벤더 모듈 5종)에 공통 적용한다 — 상세는 그 클래스의 docblock
     * 참고. v1.2.1에서 이 리스너를 신설하며 g7 코어에 직접 넣었던 동등 로직
     * (`App\Support\ImageResizer::convertPngToWebpInPlace()` 등)을 전부 제거했다.
     *
     * @return array<int, class-string>
     */
    public function getHookListeners(): array
    {
        return [
            ImagePasteWebpConversionListener::class,
        ];
    }

    /**
     * 플러그인 미들웨어 선언 반환.
     *
     * `CorrectDownloadFilenameExtension`이 PNG→WebP 변환된 이미지를 내려줄 때
     * `Content-Disposition` 파일명 확장자가 실제 내용(Content-Type)과 어긋나지
     * 않도록 보정한다(v1.2.0에서 발견된 실사고 — Content-Type은 webp인데
     * 다운로드 파일명은 .png로 나가 사용자가 "변환 안 됐다"고 오인). 응답
     * 헤더만 보고 판단하므로 대상 라우트를 전혀 수정하지 않고도 동작한다 —
     * 전부 다른 플러그인/모듈/코어 소속 라우트라 'self'가 아니라 정확한
     * 라우트명으로 하나씩 지정한다:
     *
     *  - `sirsoft-ckeditor5`의 이미지 서빙(게시글 본문 에디터 이미지)
     *  - g7 코어의 첨부 다운로드 + 템플릿 레이아웃 첨부 서빙
     *  - `sirsoft-board`의 게시판 첨부 다운로드/미리보기(일반 + 관리자)
     *  - `sirsoft-page`의 페이지 첨부 다운로드/미리보기
     *
     * (v1.2.0 시점에는 board·page 쪽은 "훅이 없어 못 고침"으로 남겨뒀던
     * 잔여 이슈였다 — 이 미들웨어는 응답 헤더만 보므로 훅 유무와 무관하게
     * 전부 커버한다. `sirsoft-ecommerce`의 카테고리/상품/리뷰 이미지는 이
     * 방식의 `Content-Disposition`을 쓰지 않는 것으로 확인돼 대상에서 제외했다.)
     *
     * @return array<int, array{class: class-string, groups: array<int, string>, targets: array<int, string>}>
     */
    public function getMiddleware(): array
    {
        return [
            [
                'class' => CorrectDownloadFilenameExtension::class,
                'groups' => ['api'],
                'targets' => [
                    'api.plugins.sirsoft-ckeditor5.api.sirsoft-ckeditor5.images.serve',
                    'api.attachment.download',
                    'api.public.templates.layout-attachment-file',
                    'api.modules.sirsoft-board.boards.attachment.download',
                    'api.modules.sirsoft-board.boards.attachment.preview',
                    'api.modules.sirsoft-board.admin.board.attachments.download',
                    'api.modules.sirsoft-page.pages.attachment.download',
                    'api.modules.sirsoft-page.pages.attachment.preview',
                ],
            ],
        ];
    }

    /**
     * 플러그인 활성화 — 관리자 메뉴 자동 등록.
     *
     * @return bool 활성화 성공 여부
     */
    public function activate(): bool
    {
        $helper = app(ExtensionMenuSyncHelper::class);

        foreach ($this->getAdminMenus() as $menuData) {
            $helper->syncMenuRecursive(
                $menuData,
                ExtensionOwnerType::Plugin,
                $this->getIdentifier(),
            );
        }

        return true;
    }

    /**
     * 플러그인 비활성화 — 관리자 메뉴 일괄 제거.
     *
     * @return bool 비활성화 성공 여부
     */
    public function deactivate(): bool
    {
        app(ExtensionMenuSyncHelper::class)->cleanupStaleMenus(
            ExtensionOwnerType::Plugin,
            $this->getIdentifier(),
            currentSlugs: [],
        );

        return true;
    }

    /**
     * 플러그인 제거 — 메뉴 잔존 안전망.
     *
     * @return bool 제거 성공 여부
     */
    public function uninstall(): bool
    {
        $this->deactivate();

        return true;
    }
}
