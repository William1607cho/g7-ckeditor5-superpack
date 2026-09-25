# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Internal

- The front-end pieces in `resources/js/src/` are renumbered into bands (`00`
  head, `01`–`09` core, `10`–`79` features, `90` boot, `99` tail), and shared
  helpers move into core pieces. Code is only moved; behavior is unchanged.
- Viewer-side features (Markdown, code copy, video, SNS embeds, link cards)
  register themselves as sections, and the page scan calls them in a fixed
  order; behavior is unchanged.
- Editor-side features (video upload, image paste, upload guards, editor style,
  code formatting) register as sections too; the code-formatting hook still
  installs at the same point while the script loads. Behavior is unchanged.

## [1.5.0] - 2026-09-25

### Added

- **Code formatting buttons in the post editor.** The post editor toolbar gets
  *Code* (after *Strikethrough*) and *Code block* (after *Block quote*), using the
  Code and CodeBlock plugins that ship in the installed CKEditor build.
  `sirsoft-ckeditor5` is not modified, and the comment editor is left alone. Code
  is saved as `<code>` and `<pre><code class="language-plaintext">`, so wiki
  links and Markdown marks inside it stay as typed. No autoformat or shortcuts are
  added. A new *Code formatting* settings tab turns the buttons off (on by
  default); saved code is always styled for display (smaller monospace, soft
  background, sideways scroll for long lines, dark-mode colors). The code block
  button has no language arrow (plain text is the only language), and a code
  block's horizontal scrollbar stays visible (8px, light and dark colors) so long
  lines don't look cut off on macOS.
- **Copy button on code blocks.** Every code block in a viewed post — toolbar code
  blocks and Markdown ```` ``` ```` blocks — gets a small half-transparent copy
  button in its top-right corner (it stays there while the block scrolls sideways;
  full opacity on hover or keyboard focus). The block's top padding grows by 36px
  so the button sits in an empty strip above the first line and never covers long
  lines; this is display only, no blank line is saved or copied. It copies the code
  exactly as shown, indentation and tabs included, using the Clipboard API with a
  hidden-textarea fallback, and shows a check mark for 1.5 seconds. Inline code gets
  no button, the editors (post and comment) get none, and the button is hidden when
  printing. It is shown regardless of the *Code formatting* setting.

### Changed

- **The plugin's routes no longer share a rate-limit counter with the rest of the
  site.** Before, they used Laravel's unnamed `throttle:N,1`. That key is the member
  id or the visitor IP, with no route in it. So every public Gnuboard7 API (board
  lists, menus, widgets at 600/minute) counted against the same number. A visitor
  who had just browsed a few pages could hit the link-preview limit of 30 on the
  first card, and the link stayed a plain link.
  - Each route group now has its own named limiter. The key is `user:<id>` for a
    signed-in member and `ip:<address>` otherwise.

    | Limiter | Routes | Per minute |
    |---|---|---|
    | `g7-ckeditor5-superpack.link-preview` | `GET link-preview` | 60 (was 30) |
    | `g7-ckeditor5-superpack.video-session` | `POST video/upload/init`, `POST video/upload/complete` | 60 |
    | `g7-ckeditor5-superpack.video-chunk` | `POST video/upload/chunk` | 1200 |
    | `g7-ckeditor5-superpack.video-meta` | `POST video/meta` | 120 |
    | `g7-ckeditor5-superpack.video-serve` | `GET video/{id}` | 600 |

  - Over the limit, the response is the same `429` as before.
  - The limiters are registered when the plugin boots, so they also work with a
    route cache.
  - The limit on real outbound link-preview fetches is unchanged (120 per minute
    site-wide, 20 per minute per host).
- **Behind a reverse proxy**, set `TRUSTED_PROXIES` in the core `.env`. Otherwise
  every visitor is seen as the proxy's address and shares one link-preview
  allowance. Check it with `php artisan trusted-proxy:status`.
- **A link card that gets a 429 is retried once instead of giving up.** The retry
  waits for `Retry-After` (up to 10 seconds, or 2 seconds when the header is
  missing) plus up to 1 second of jitter. Cards for the same address now share one
  request.

### Fixed

- **Editor style no longer drops out while you edit.** The font size and line height
  from "Editor style" fell back to the page default when the editor gained or lost
  focus, and stayed that way until something else changed on the page. The marker
  class now sits on the editor's outer container, which CKEditor does not rewrite.
- **The comment box follows "Apply to comments too".** Before, the comment editor
  picked up the post editor's font size and line height whether that option was on
  or off. Now it gets them only when the option is on.
- **Headings from the toolbar look like headings again.** With "Editor style" on,
  Heading 1/2/3 (`h2`/`h3`/`h4`) showed at body size in the editor and on the post
  page, because the theme resets heading sizes to `inherit`. They now get 1.5 / 1.3 /
  1.15 times the body size, bold, with their own line height and spacing. Sizes set
  inline with the font-size tool still win, and Markdown headings keep their own
  styles.
- **The post editor no longer runs the visitor-side link processing.** Bare links in
  the editor were being marked for SNS embeds, link cards and video, and each one
  fired a link-preview request while you wrote. Editing areas are now skipped.
- **Only one video upload bar per post editor.** CKEditor's `ckeditor5-*` style and
  script tags in `<head>` were taken for editor containers, which put extra upload
  bars inside `<head>`. Only containers that actually hold an editor are used now.
- **Image pasting is no longer intercepted in the comment box.** The comment editor
  has no image upload, but pasted images were caught and then dropped. The
  paste handler and upload timeout guard are now attached to the post editor only.
- **Missing translations added.** The image paste size notice, the "wait for the
  upload" notice, the "Uploading" button label, the upload timeout notice and the
  copy button labels now come from the language files (English and Korean) instead
  of built-in Korean text.
- **Minimal link cards no longer jump after they appear.** The favicon slot stays
  hidden until the icon actually loads, so a blocked favicon no longer removes the
  slot and shifts the title.
- **Stale editors are dropped from the image paste list**, so the list no longer
  grows as you move between pages.
- **Embed re-processing is scheduled once per scan burst** (2, 5 and 10 seconds
  after the last scan) instead of stacking new timers on every scan.
- **The video file picker filter follows the allowed formats**, so formats that are
  turned off are no longer offered.

### Internal

- The front-end source is split by feature into 14 numbered pieces in
  `resources/js/src/`. `scripts/build-js.sh` joins them in name order into
  `dist/js/plugin.iife.js` and `resources/js/index.js` (the two files are always
  identical); `--check` verifies that both are up to date. The shipped script is
  that joined result. `scripts/` is not included in release archives.

## [1.4.0] - 2026-09-17

### Security

- **Link-preview address checks no longer rely on Gnuboard7's validator alone.** On
  PHP 8.2 that validator lets through CGNAT `100.64.0.0/10` (the range Tailscale
  uses), `198.18.0.0/15`, `192.0.0.0/24`, and IPv4-mapped IPv6 such as
  `http://[::ffff:127.0.0.1]/`. The last one reaches the server's own loopback.
  - Every hop now requires `FILTER_FLAG_GLOBAL_RANGE` plus a plugin block list:
    `100.64.0.0/10`, `198.18.0.0/15`, `192.0.0.0/24`, `0.0.0.0/8`, `fc00::/7`,
    `fe80::/10`, `64:ff9b::/96`, `2002::/16`.
  - IPv4-mapped / IPv4-compatible addresses are checked by their embedded IPv4.
  - Numeric host forms (`2130706433`, `0177.0.0.1`, `0x7f.1`) are checked as the
    address they resolve to.
- **Bounded downloads.** Pages are fetched by a new curl-based fetcher instead of
  Laravel's HTTP client.
  - The connection is pinned to the checked IP, and proxy environment variables are
    ignored.
  - The server sends `Accept-Encoding: identity` and refuses compressed responses.
    This rules out decompression bombs.
  - A non-HTML `Content-Type` is dropped before any body is read.
  - The body is cut at 1 MiB. Before, the whole response was buffered in memory.
  - Timeouts: 3 s to connect, 8 s in total across all redirect hops. Before, the
    limit was 5 s per hop, up to about 20 s.
- **Rate limits.**
  - Real outbound fetches are limited to 120 per minute site-wide and 20 per minute
    per target host. Cache hits don't count. Over the limit, the endpoint answers
    `failed` without caching it.
  - The route limit is lowered from 60 to 30 requests per minute per IP.

### Added

- **`g7-ckeditor5-superpack:prune-link-previews`** (`--dry-run`, `--scheduled`).
  - Deletes link-card cache rows past their TTL (success / failure TTL settings,
    defaults 7 days / 24 hours).
  - Keeps the table at 50,000 rows at most by removing the oldest first.
  - Scheduled daily at `30 0 * * *`, 30 minutes after the video prune.
  - Before this, expired rows were never deleted.

### Fixed

- A 3xx on the last allowed request now counts as `failed`. Before, a card could be
  built from the redirect page's `<title>`.
- A redirect `Location` (or `og:image`) with a non-HTTP scheme is no longer glued onto
  the current path as if it were relative.
- `og:image` / favicon URLs longer than the column size are dropped instead of being
  cut into broken URLs.
- Invalid UTF-8 in fetched titles is replaced instead of causing a database error.
- Two requests saving the same new link at the same time no longer fail. The row the
  other request saved is used instead.
- Failure log entries record only the host and the curl error code, not the full URL.

## [1.3.1] - 2026-09-15

### Fixed

- **Single list lines separated by a converted block are no longer merged.** A
  lone `- item` line, a converted heading / blockquote / fenced code block, and
  another lone `- item` line (e.g. `- a`, `# Heading`, `- b`) used to end up as one
  `<ul>` placed *before* the heading, because the page's repeated scans skipped
  already-converted blocks when looking for consecutive lines. Converted blocks now
  stay in place as boundaries, so the lines render in their original order and
  repeated scans give the same result. This was listed as a known issue in 1.3.0 and
  predates it. Output for every other markdown case is unchanged (verified against
  1.2.1 and 1.3.0 with the same corpus in Chromium).

### Changed

- **`md_hr` off now leaves the line as literal text** (`---`), as in 1.2.1, instead of
  hiding it. With the toggle on (default), whole-line `---` / `***` / `___` still
  renders as `<hr>`.

## [1.3.0] - 2026-09-15

### Added

- **Markdown tables** (`md_table`, on by default) — a GFM table (a header row
  immediately followed by a delimiter row such as `|---|:---:|` with the same column
  count) is rendered as `<figure class="table"><table>` on the visitor-facing page.
  The first row becomes `<th>` header cells; bold, links and inline code inside cells
  are converted too; `\|` is a literal pipe inside a cell. Column alignment marks
  (`:---`, `---:`) are ignored. Tables pasted as `<br>`-joined lines are split per
  line first, like the other block elements. Many-column tables get horizontal
  overflow instead of breaking the layout.
- **Horizontal rules** (`md_hr`, on by default) — a whole line of `---`, `***` or
  `___` (3+) is rendered as `<hr>`, regardless of the `sirsoft-ckeditor5` toolbar
  setting (the conversion is render-time, so the editor's HorizontalLine plugin is
  not involved). (1.3.0 hid the line when the toggle was off; see 1.3.1.)
- Both elements get a checkbox in the *Markdown auto-convert* settings tab. Existing
  installs pick up the defaults without re-saving settings.

### Notes

- As before, nothing is stored differently: the post body keeps the literal
  markdown text, and re-opening the post in the editor shows it unchanged.
- Output for the existing elements (headings, bold, italic, lists, links, code,
  blockquotes) is unchanged; this was verified by rendering the same corpus with
  1.2.1 and 1.3.0 in Chromium and comparing the resulting DOM.

## [1.2.1] - 2026-09-12

### Changed

- **PNG→WebP conversion is now fully self-contained in this plugin — no core
  patch required.** In 1.2.0 the conversion engine
  (`App\Support\ImageResizer::convertPngToWebpInPlace()`) and the download-filename
  fix lived outside this package, in Gnuboard7 core and in `sirsoft-ckeditor5`; the
  `imagepaste_webp_enabled` toggle was a silent no-op without that patch. Both are
  now implemented inside the plugin (`ImagePasteWebpConverter`,
  `ImagePasteWebpConversionListener`, `CorrectDownloadFilenameExtension`) and wired
  in purely through filter hooks the host code already exposes and a scoped
  response middleware — no other plugin, module, or core file is modified. The
  matching core patch has been fully reverted on the reference install (verified
  byte-identical to the pristine upstream `sirsoft-ckeditor5` source after
  reverting). This is an internal restructuring; behavior and settings are
  unchanged for existing installs.
- As a side effect, the download-filename fix now also covers `sirsoft-board` and
  `sirsoft-page` attachment downloads/previews, which 1.2.0 could not reach (no
  filter hook existed at those serve points; the new middleware works from
  response headers alone, so it doesn't need one).

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
