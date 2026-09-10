# g7-ckeditor5-superpack

[![Release](https://img.shields.io/github/v/release/William1607cho/g7-ckeditor5-superpack?sort=semver)](https://github.com/William1607cho/g7-ckeditor5-superpack/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

A [Gnuboard7](https://github.com/gnuboard/g7) plugin that adds four render-time
enhancements to posts written with the **`sirsoft-ckeditor5`** editor — **without
modifying the editor itself**:

1. **SNS embeds** — a YouTube / X (Twitter) / Instagram / TikTok link on its own line
   becomes a platform embed on the visitor-facing page.
2. **External link cards** — any other external link becomes an OpenGraph card
   (thumbnail + title + summary + domain) or a minimal card (favicon + title + domain).
3. **Local video upload** — an *Upload video* button above the editor uploads MP4 / MOV
   / WebM in chunks; the link renders as a `<video controls>` player on view.
4. **Markdown auto-convert** — literal markdown marks (`##`, `**bold**`, `- item`,
   pasted from an AI assistant, etc.) are turned into real formatting when the post is
   viewed. The stored text is left byte-for-byte unchanged.

In every case the stored content is just plain `<a href>` links and the original
text. All conversion happens on the visitor-facing page (and, for the editor button
and media library, in the write screen) via one globally-loaded script. Each feature
has its own on/off switch and detailed options in the admin screen.

한국어 사용 안내는 아래 [사용법 (한국어)](#사용법-한국어) 절을 참고하세요.

---

## How it works

The plugin declares `loading.strategy: "global"`, so its single built script
(`dist/js/plugin.iife.js`) is concatenated into the g7 asset bundle and runs on every
admin and front page. On the visitor-facing page it scans each `.ck-content` block
(plus a `MutationObserver` for SPA navigation) and rewrites the DOM:

- markdown marks → real elements (`<h1>`–`<h3>`, `<strong>`, `<ul>`/`<ol>`,
  `<blockquote>`, `<code>`/`<pre>`, `<a>`);
- own-server video links → `<video controls>`;
- bare SNS links → platform embeds;
- other bare external links → link-preview cards (metadata fetched by a server
  endpoint with SSRF defenses and cached in a table).

In the write screen it injects the *Upload video* button and a media-library strip
above the editor using `element.ckeditorInstance` — it never registers a CKEditor
plugin, so `sirsoft-ckeditor5` stays untouched.

Turning a feature off in the settings makes the script skip that scan entirely.

## Requirements

- Gnuboard7 `>= 7.0.10`
- PHP `>= 8.2`
- Plugin **`sirsoft-ckeditor5` `>= 1.0.3`**, installed and active — declared in
  `plugin.json` `dependencies`, so the g7 plugin manager checks it automatically and
  blocks activation if it is missing.
- The **`sirsoft-board`** module is needed only for the *video auto-delete* option
  (it looks up whether a video is still referenced by any post body). Every other
  feature works without it, and the option is off by default.

## Installation

### From GitHub (CLI)

```bash
cd /path/to/gnuboard7/plugins

# a release tag (recommended)
curl -L https://github.com/William1607cho/g7-ckeditor5-superpack/archive/refs/tags/v1.0.0.tar.gz | tar xz
mv g7-ckeditor5-superpack-1.0.0 g7-ckeditor5-superpack

# ...or the latest main
git clone https://github.com/William1607cho/g7-ckeditor5-superpack.git

# then, from the Gnuboard7 root:
cd ..
php artisan plugin:install g7-ckeditor5-superpack
php artisan plugin:activate g7-ckeditor5-superpack
php artisan config:clear
php artisan plugin:cache-clear
```

`plugin:install` runs the two migrations (link-preview cache table + two video
tables). If the global script does not seem to load, clear the caches once more and
reload.

### From the admin UI

Download a zip of a
[release](https://github.com/William1607cho/g7-ckeditor5-superpack/releases) (or the
repo) and install it via **Admin → Plugins → Install → file upload**. The zip's
top-level folder must be named `g7-ckeditor5-superpack`.

There is **no build step** — `resources/js/index.js` and `dist/js/plugin.iife.js` are
kept identical and both are committed.

## Usage

Open **Admin → Plugins → CKEditor 5 Superpack → Settings**
(`/admin/plugins/g7-ckeditor5-superpack/settings`). Four tabs, one per feature.

### 1. SNS embeds

Paste a link **on its own line** in the post body — nothing else to do.

| Platform | Rendering |
| --- | --- |
| YouTube · YouTube Shorts | `youtube-nocookie.com/embed` iframe (no script) |
| X (Twitter) | official `widgets.js`, loaded once |
| Instagram (posts · reels) | official `embed.js` |
| TikTok | official `embed.js` |

Every embed keeps a permanent "view on …" link, so it degrades to a link if the
platform script is blocked. Tracking / consent query parameters (`?utm_source`,
`?is_from_webapp`, …) are stripped before embedding.

**Settings:** master on/off · per-platform on/off · YouTube Shorts aspect ratio
(9:16 / 1:1 / 4:5 / 16:9 — the URL alone cannot tell the real orientation, so
non-vertical Shorts get letterboxing).

### 2. External link cards

Any bare external link that is not an SNS embed target becomes a card:

- **Full card** — thumbnail + title + summary + domain (when OpenGraph metadata is
  available).
- **Minimal card** — favicon + title + domain (only `<title>` available — e.g. a
  Cloudflare challenge page).
- **Fallback** — the original link is kept as-is (long URLs wrap via CSS).

Metadata is fetched server-side by `GET /api/plugins/g7-ckeditor5-superpack/link-preview`
with SSRF defenses (private/loopback/link-local/metadata-IP blocking, resolved-IP
re-validation against DNS rebinding, pinned `CURLOPT_RESOLVE`, manual redirect hops)
and cached in `g7_superpack_link_previews`.

**Settings:** master on/off · minimal-card on/off · thumbnail size (px) · success
cache TTL (days) · failure cache TTL (hours).

### 3. Local video upload

Click **Upload video** above the editor and pick a file. It uploads in chunks
(`init` → `chunk` × N → `complete`), assembled server-side with
`stream_copy_to_stream` (never held fully in memory), then:

- **Write screen** — a **media-library** strip above the button shows a real
  `<video controls>` card for every video **in the current post**. On a new post it
  fills as you upload; on an edit screen it re-hydrates by parsing the body for
  `…/video/{id}` links. Click a card to (re)insert its link at the cursor — any
  number of times, or at the document end if the editor is not focused. Each card has
  **S / M / L** size buttons. The body itself only ever gets a plain link (see
  *Known limitations*); in the editor that link is shown as a fixed-size box with the
  filename centred.
- **Visitor page** — the renderer promotes any `.ck-content` link whose href matches
  `…/video/{32-hex}` into a `<video controls>` player, regardless of the link text or
  whether the href is relative. `?size=sm|lg` on the link sets the width
  (360 / 640 / 960 px).

Serving uses `BinaryFileResponse`, so `Range` requests (seeking / streaming) return
`206 Partial Content` automatically, with the correct per-container MIME type.

**Formats:** `.mp4` always; `.mov` and `.webm` on by default; `.m4v` opt-in. The
filename's container family (ISO-BMFF `ftyp` / EBML) must match the actual magic
bytes — a `.webm` payload renamed to `.mp4` is rejected.

**Codec note:** playback still depends on browser codec support. HEVC / H.265 `.mov`
files (recent iPhones) will not play in Firefox or older Chrome; there is no
transcoding. H.264 `.mp4` has the widest compatibility.

**Security:** size cap (setting, hard cap 2048 MB) · container-signature check ·
upload endpoints are admin-gated (`auth:sanctum` + admin, the same scope as writing a
post); the serve endpoint is public via an unguessable 32-hex id. Files are stored
under `storage/app/plugins/g7-ckeditor5-superpack/videos/`, separate from board
attachments. Tables: `g7_superpack_video_uploads`, `g7_superpack_video_upload_sessions`.

A daily `g7-ckeditor5-superpack:prune-videos` command always clears expired upload
sessions, and — only when **auto-delete retention (days) > 0** — deletes video files
that are older than the retention period and not referenced by any post body.

**Settings:** master on/off · max file size (MB) · chunk size (MB) · allowed
extensions (`.mov` / `.webm` / `.m4v`) · auto-delete retention (days, `0` = keep
forever, opt-in).

### 4. Markdown auto-convert

CKEditor 5 does not auto-format markdown on paste, so text copied from an AI
assistant keeps literal `##` / `**bold**` marks. With this on, the visitor-facing
renderer turns those marks into real formatting **when the post is viewed** — the
stored body is unchanged, and conversion never runs inside the editor.

| Element | Pattern | Default |
| --- | --- | --- |
| Headings | line-start `#` / `##` / `###` | on |
| Bold | `**text**` | on |
| Italic | `*text*` | **off** (a stray `*` in prose is easily misread) |
| Lists | `- x` / `1. x`, on **2+ consecutive** lines | on |
| Links | `[text](http…)` | on |
| Code | `` `inline` `` and fenced ```` ``` ```` blocks | on |
| Blockquote | line-start `> ` | on |

**False-positive guards:** a block converts only if the whole paragraph's text
matches `mark + space + content` exactly and it has no child elements; a paragraph
that already has editor formatting is skipped for inline conversion; bold/italic
match only marks not wrapped in whitespace (so `2 * 3 * 4` is left alone); a lone
`- item` line or `2024. text` line is left alone. Multi-line markdown pasted as one
`<p>` with `<br>` soft-breaks is split per line first, so `<br>`-joined lists /
quotes / headings still convert. Conversion is idempotent (marker attributes on
converted nodes) and runs the markdown pass **first**, so a `[text](url)` is already
a real `<a>` before the SNS / card passes see it.

**Settings:** master on/off · a per-element on/off for each of the seven above (e.g.
headings on, lists off).

## Settings screen

**Admin → Plugins → CKEditor 5 Superpack → Settings** shows a short description line
and four tabs, one per feature. Each tab has a master on/off switch at the top
followed by that feature's detailed options:

- **SNS embeds** — per-platform on/off (YouTube · X · Instagram · TikTok) and the
  YouTube Shorts aspect ratio.
- **External link cards** — minimal-card on/off, thumbnail size, and the success /
  failure cache TTLs.
- **Local video upload** — max file size, chunk size, the `.mov` / `.webm` / `.m4v`
  extension toggles, and the auto-delete retention period, with a codec-compatibility
  note.
- **Markdown auto-convert** — a per-element on/off for headings, bold, italic (off by
  default), lists, links, code and blockquote.

## Known limitations

- **No true inline `<video>` in the editor body.** CKEditor 5 (43.3.1) does not keep
  `<video>`, `<figure class>`, or `class` / `data-*` on `<a>` in its content model,
  even with a GHS wildcard rule (verified). The plugin therefore stores a plain link
  and provides the media-library strip + an in-editor box style instead of an inline
  player.
- A legacy `<figure class="media"><oembed url>` shape saved by an older setup is
  still recognised on view, but the current editor never produces it.
- SNS embeds that negotiate their height over `postMessage` (X, Instagram) can
  briefly collapse to `0px` when the same page is reloaded many times in quick
  succession; a normal single view is fine, and the "view on …" link is always
  present.
- Playback depends on the browser's codec support (see the codec note above).

## <a name="사용법-한국어"></a>사용법 (한국어)

**관리자 → 플러그인 → CKEditor 5 슈퍼팩 → 설정** 으로 이동합니다. 탭 4개, 기능별로 하나씩.

- **SNS 임베드** — 본문에 YouTube·X·Instagram·TikTok 링크를 **한 줄에 단독으로** 붙여넣으면
  방문자 화면에서 임베드로 표시됩니다. 임베드 아래에는 항상 원문 링크 버튼이 남습니다.
  설정: 전체 온/오프 · 플랫폼별 온/오프 · YouTube Shorts 세로 비율.
- **외부 링크 카드화** — 임베드 대상이 아닌 일반 외부 링크를 대표이미지+제목+요약+도메인
  카드(또는 파비콘+제목+도메인 최소 카드)로 바꿉니다. 메타 취득은 서버가 대행하고 캐시합니다.
  설정: 전체 온/오프 · 최소 카드 온/오프 · 이미지 크기 · 성공/실패 캐시 보존기간.
- **로컬 동영상 업로드** — 에디터 위 "동영상 업로드" 버튼으로 MP4/MOV/WebM 을 청크 업로드합니다.
  편집 화면의 미디어 라이브러리에서 카드를 클릭하면 커서 위치에 삽입되고, S/M/L 크기를 고를 수
  있습니다. 방문자 화면에서는 링크가 재생 플레이어로 바뀝니다. `.mp4` 는 항상, `.mov`·`.webm` 은
  기본 허용, `.m4v` 는 옵트인. 확장자와 실제 매직바이트가 일치해야 통과합니다. HEVC(H.265) `.mov`
  는 일부 브라우저에서 재생되지 않습니다(트랜스코딩 없음). 자동 삭제 보관기간은 기본 0(무기한).
- **마크다운 자동 변환** — 붙여넣은 `##`, `**굵게**` 같은 기호를 방문자 화면에서 실제 서식으로
  바꿉니다. 본문 원문은 그대로 저장됩니다. 지원: 제목 / 굵게 / 기울임(기본 OFF) / 목록(2줄 이상
  연속) / 링크 / 코드 / 인용구, 요소별 온/오프. `#태그`(공백 없음)·`####`·단일 `- 문장`·`2024.`
  같은 것은 변환하지 않습니다.

각 기능을 끄면 해당 처리를 완전히 건너뜁니다. `sirsoft-ckeditor5` 는 전혀 수정하지 않습니다.

## Acknowledgments

Built on the standard Gnuboard7 extension patterns. The plugin structure (the
`loading.strategy: "global"` asset strategy, `frontend_schema` for exposing settings
to the front-end, the declarative admin settings layout, migration/route layout) was
informed by SIRSOFT's MIT-licensed Gnuboard7 plugins (`sirsoft-ckeditor5`,
`sirsoft-daum_postcode`) and by the author's own `g7-global-font` plugin, used as a
reference for *how* a plugin wires into the core — **no source code from those
plugins is included here**. `sirsoft-ckeditor5` is a runtime dependency only; it is
referenced, never bundled or modified.

CKEditor 5 itself is GPL-licensed and is provided by the `sirsoft-ckeditor5` plugin,
not by this one.

## License

[MIT](./LICENSE) © 2026 William Cho
