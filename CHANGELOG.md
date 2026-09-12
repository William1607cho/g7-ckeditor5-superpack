# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-09-12

### Added

- **Image paste** — a new admin tab with two independent toggles (both on by
  default):
  - **Auto-upload pasted clipboard images** (`imagepaste_enabled`) — pasting an
    image copied or dragged from another site into the post body editor uploads it
    automatically through the existing local upload pipeline (CKEditor 5's standard
    `uploadImage` command), as long as the clipboard actually holds image binary
    data rather than just an HTML reference to it. This replaces an earlier
    rehosting-based approach (the server re-fetching the external URL) that was
    tried and dropped for reliability reasons — success no longer depends on the
    source site's CORS/hotlink policy. Turning this off fully restores
    `sirsoft-ckeditor5`'s native paste behavior; plain screenshot pasting is
    unaffected either way, since it already went through that native path.
  - **Auto-convert uploaded PNG images to WebP** (`imagepaste_webp_enabled`) —
    mitigates browsers re-encoding pasted images as PNG (which inflates file size)
    by re-compressing PNG uploads to WebP server-side, lossless first with a
    high-quality lossy fallback, never producing a larger file than the original.
    **This toggle ships in the plugin, but the code it controls does not** — see
    "Known limitations" in the README and the `Plugin` class docblock in
    `plugin.php`. Without a companion server-side patch (present on the
    william-cho.com install this plugin was built for, not included in this
    package), the toggle is a no-op.

### Fixed

- Submitting a post ("글 작성 완료") while a pasted image is still uploading used to
  save the post with an empty `<img>` (no `src`). The submit button is now locked
  while any registered editor has an upload in flight, using CKEditor 5's standard
  `PendingActions` plugin. This is a general fix, not gated by either toggle above —
  it also retroactively covers plain screenshot pasting, which had the same
  pre-existing gap.

## [1.1.0] - 2026-09-11

### Added

- **Editor style** — a new admin tab sets a site-wide base font size (12–28px) and
  line height (1.2 / 1.4 / 1.6 / 1.8 / 2.0) for the post body, applied to both the
  writing screen and the published post via a `.ck-content.prose` CSS rule. Off by
  default, and already-published posts are affected too since the rule targets the
  render class rather than stored content.
  - An **Also apply to comments** option extends the same font size / line height to
    rendered comments. Comments don't share the post body's `.ck-content`/`prose`
    rendering path, so this targets the comment paragraph directly
    (`p.text-gray-700.dark:text-gray-300`).
  - Settings: master on/off, base font size, line height, apply-to-comments toggle.

## [1.0.0] - 2026-09-10

### Added

- Initial public release. A standalone Gnuboard7 plugin that adds four render-time
  enhancements to `sirsoft-ckeditor5` posts **without modifying the editor**. Stored
  content stays as plain `<a href>` links and original text; all conversion happens
  on the visitor-facing page via one globally-loaded script
  (`loading.strategy: "global"`), plus editor-side UI injected through
  `element.ckeditorInstance`.

- **SNS embeds** — a YouTube / X (Twitter) / Instagram / TikTok link on its own line
  is rendered as a platform embed. YouTube uses a `youtube-nocookie.com/embed`
  iframe; the others load the official embed script once. Every embed keeps a
  permanent "view on …" link, and tracking / consent query parameters are stripped
  before embedding. A legacy `<figure class="media"><oembed url>` shape is still
  handled if present.
  Settings: master on/off, per-platform on/off, YouTube Shorts aspect ratio.

- **External link cards** — any other bare external link becomes an OpenGraph card
  (thumbnail + title + summary + domain) or a minimal card (favicon + title +
  domain), falling back to the plain link on failure. Metadata is fetched by
  `GET /api/plugins/g7-ckeditor5-superpack/link-preview` with SSRF defenses
  (private/loopback/metadata-IP blocking, resolved-IP re-validation, pinned
  `CURLOPT_RESOLVE`, manual redirect hops) and cached in `g7_superpack_link_previews`.
  Settings: master on/off, minimal-card on/off, thumbnail size, success/failure cache
  TTL.

- **Local video upload** — an *Upload video* button above the editor uploads MP4 /
  MOV / WebM in chunks (`init` → `chunk` × N → `complete`), assembled server-side with
  `stream_copy_to_stream`. On the write screen a media-library strip shows a
  `<video controls>` card for every video referenced by the current post (hydrated
  from the body on an edit screen); clicking a card inserts its link at the cursor,
  with S / M / L size presets carried as `?size=`. On the visitor page any
  `…/video/{32-hex}` link is promoted to a `<video controls>` player. Serving uses
  `BinaryFileResponse` (`Range` → `206`) with the correct per-container MIME type.
  - Formats: `.mp4` always, `.mov` / `.webm` on by default, `.m4v` opt-in; the
    filename's container family (ISO-BMFF `ftyp` / EBML) must match the actual magic
    bytes.
  - Security: size cap (hard cap 2048 MB), container-signature check, admin-gated
    upload endpoints, public serve via an unguessable 32-hex id, storage separated
    from board attachments. Tables: `g7_superpack_video_uploads`,
    `g7_superpack_video_upload_sessions`.
  - A daily `g7-ckeditor5-superpack:prune-videos` command clears expired sessions
    always, and deletes unreferenced expired video files only when auto-delete
    retention (days) is greater than 0 (default 0 = keep forever).
  - Settings: master on/off, max file size, chunk size, allowed extensions,
    auto-delete retention.

- **Markdown auto-convert** — literal markdown marks (`##`, `**bold**`, `- item`, …)
  in a stored post are turned into real formatting on view; the stored body is left
  byte-for-byte unchanged and conversion never runs inside the editor. Supported:
  headings, bold, italic (off by default), unordered / ordered lists (2+ consecutive
  lines), links, inline + fenced code, blockquote — each with its own on/off.
  Multi-line markdown pasted as one `<p>` with `<br>` soft-breaks is split per line
  first. False-positive guards keep prose `#`, `####`, a lone `- item`, `2024. text`,
  and whitespace-wrapped `*` untouched. The markdown pass runs first, so a
  `[text](url)` is a real `<a>` before the SNS / card passes see it. Conversion is
  idempotent, and the plugin ships its own CSS for the elements it generates (the
  visitor template's Tailwind Preflight resets headings and list markers).
  Settings: master on/off plus a per-element on/off.

- **Admin settings screen** with four tabs, one per feature. Values the front-end
  script needs are exposed through `frontend_schema` and read from
  `window.G7Config.plugins['g7-ckeditor5-superpack']` — no extra API call.

- **`sirsoft-ckeditor5` is never modified** — it is a runtime dependency
  (`>= 1.0.3`, declared in `plugin.json`), referenced only. The editor button and
  media library are injected by the global script, not a CKEditor plugin.
