# g7-ckeditor5-superpack

[![Release](https://img.shields.io/github/v/release/William1607cho/g7-ckeditor5-superpack?sort=semver)](https://github.com/William1607cho/g7-ckeditor5-superpack/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

A [Gnuboard7](https://github.com/gnuboard/g7) plugin that adds seven
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
5. **Editor style** — a site-wide base font size and line height for the post body
   (with sized toolbar headings), optionally extended to comments and the comment box.
6. **Image paste** — an image copied from another site and pasted into the post body
   is uploaded to this site, and uploaded PNGs can be re-compressed to WebP.
7. **Code formatting** — *Code* and *Code block* buttons in the post editor toolbar.
   Code is saved as real `<code>` / `<pre>`, so its text is shown as typed. Code
   blocks in a viewed post get a copy button.

For embeds, link cards, video and Markdown the stored content is just plain
`<a href>` links and the original text; the conversion happens on the
visitor-facing page. Editor style is a CSS rule, image paste uploads through the
editor's own upload path, and code formatting stores standard `<code>` / `<pre>`.
Everything runs from one globally-loaded script (plus, for the editor button and
media library, in the write screen). Each feature has its own on/off switch and
detailed options in the admin screen.

한국어 사용 안내는 아래 [사용법 (한국어)](#사용법-한국어) 절을 참고하세요.

---

## How it works

The plugin declares `loading.strategy: "global"`, so its single built script
(`dist/js/plugin.iife.js`) is concatenated into the g7 asset bundle and runs on every
admin and front page. On the visitor-facing page it scans each `.ck-content` block
(plus a `MutationObserver` for SPA navigation) and rewrites the DOM:

- markdown marks → real elements (`<h1>`–`<h3>`, `<strong>`, `<ul>`/`<ol>`,
  `<blockquote>`, `<code>`/`<pre>`, `<a>`, `<table>`, `<hr>`);
- own-server video links → `<video controls>`;
- bare SNS links → platform embeds;
- other bare external links → link-preview cards (metadata fetched by a server
  endpoint with SSRF defenses and cached in a table).

In the write screen it injects the *Upload video* button and a media-library strip
above the editor using `element.ckeditorInstance`. For code formatting it adds the
build's own Code / CodeBlock plugins to the post editor's config at creation time
(by wrapping `ClassicEditor.create`), so `sirsoft-ckeditor5` stays untouched.

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
- PHP extension **`curl`** — used by the link-card fetcher (1.4.0+). Laravel's HTTP
  client already relies on it in a standard Gnuboard7 install.
- PHP extension **`imagick`** (optional) — needed only for the *PNG→WebP auto-convert*
  option. If it's not loaded, that option is a silent no-op (PNGs are stored as-is);
  every other feature is unaffected.

## Installation

### From GitHub (CLI)

```bash
cd /path/to/gnuboard7/plugins

# a release tag (recommended)
curl -L https://github.com/William1607cho/g7-ckeditor5-superpack/archive/refs/tags/v1.6.0.tar.gz | tar xz
mv g7-ckeditor5-superpack-1.6.0 g7-ckeditor5-superpack

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
(`/admin/plugins/g7-ckeditor5-superpack/settings`). Seven tabs, one per feature.

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
  Cloudflare challenge page). The favicon is shown only once it has loaded, so a
  blocked icon leaves the card as first drawn.
- **Fallback** — the original link is kept as-is (long URLs wrap via CSS).

Metadata is fetched server-side by `GET /api/plugins/g7-ckeditor5-superpack/link-preview`
(public, 60 requests/minute per IP on its own named limiter, counted separately from
other APIs) and cached in `g7_superpack_link_previews`. If that request gets a `429`,
the page retries it once after `Retry-After` (up to 10 s; 2 s when the header is
missing), and cards for the same address share one request. Behind a reverse proxy,
set `TRUSTED_PROXIES` in the core `.env` so each visitor is counted by their own
address. Links inside the editor are left as links; cards appear only on the
visitor page.

**Server-side safeguards (1.4.0):**

- **Address checks on every hop.** Every resolved IP must be a global address
  (`FILTER_FLAG_GLOBAL_RANGE`), and the plugin also blocks `100.64.0.0/10` (CGNAT,
  e.g. Tailscale), `198.18.0.0/15`, `192.0.0.0/24`, `0.0.0.0/8`, `fc00::/7`,
  `fe80::/10`, `64:ff9b::/96` and `2002::/16`.
  - IPv4-mapped / IPv4-compatible IPv6 addresses (`::ffff:127.0.0.1`) are checked by
    their embedded IPv4.
  - Numeric host forms (`2130706433`, `0177.0.0.1`, `0x7f.1`) are checked as the IP
    they resolve to.
  - These checks apply even when Gnuboard7's own URL validator would let the address
    through.
- **Connection pinning.** The connection is pinned to the checked IP
  (`CURLOPT_RESOLVE`), and proxy environment variables are ignored.
- **Redirects.** They are followed manually, up to 4 requests per link. A 3xx on the
  last request counts as failed.
- **Bounded download.**
  - The server asks for `Accept-Encoding: identity`; a compressed response counts as
    failed.
  - A non-HTML `Content-Type` is dropped before the body is read.
  - The body is cut at 1 MiB.
  - Timeouts: 3 s to connect, 8 s in total across all hops.
- **Rate limits on real fetches only.** At most 120 per minute site-wide and 20 per
  minute per target host. Over the limit, the answer is `failed` and nothing is cached.
- **Cache cleanup.** A daily `g7-ckeditor5-superpack:prune-link-previews` command
  (00:30 in the scheduler's time) deletes rows past their TTL and keeps the table at
  50,000 rows at most by removing the oldest first. Run it by hand with `--dry-run`
  to see the counts without deleting anything.

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
| Tables | GFM table: header row + `\|---\|---\|` delimiter row with the same column count | on |
| Horizontal rule | a whole line of `---` / `***` / `___` | on |

**False-positive guards:** a block converts only if the whole paragraph's text
matches `mark + space + content` exactly and it has no child elements; a paragraph
that already has editor formatting is skipped for inline conversion; bold/italic
match only marks not wrapped in whitespace (so `2 * 3 * 4` is left alone); a lone
`- item` line or `2024. text` line is left alone. Multi-line markdown pasted as one
`<p>` with `<br>` soft-breaks is split per line first, so `<br>`-joined lists /
quotes / headings still convert. Conversion is idempotent (marker attributes on
converted nodes) and runs the markdown pass **first**, so a `[text](url)` is already
a real `<a>` before the SNS / card passes see it.

**Tables:** the first row becomes header cells; bold / links / inline code inside cells
are converted; `\|` is a literal pipe; alignment marks (`:---`, `---:`) are ignored;
wide tables scroll horizontally. **Horizontal rules** are always rendered as `<hr>`,
independent of the `sirsoft-ckeditor5` toolbar type (render-time conversion doesn't
need the editor's HorizontalLine plugin).

**Settings:** master on/off · a per-element on/off for each of the nine above (e.g.
headings on, lists off).

### 5. Editor style

Sets a site-wide base font size (12–28px) and line height (1.2 / 1.4 / 1.6 / 1.8 /
2.0) for the post body. Off by default; when on, it applies to the writing screen
*and* the published post — including already-published posts, since it's a CSS rule
targeting the render class rather than a content transform. In the editor the style
stays in place while you type and when the editor gains or loses focus.

With it on, toolbar headings (Heading 1 / 2 / 3, saved as `h2` / `h3` / `h4`) get
1.5 / 1.3 / 1.15 times the body size, bold, with their own line height and spacing —
the theme otherwise resets heading sizes to the body size. A size set inline with the
font-size tool still wins; Markdown headings keep their own styles.

Comments don't share the post body's `.ck-content`/`prose` rendering — they're
rendered as plain text by sirsoft-board and promoted to HTML client-side by
[`g7-comment-editor`](https://github.com/William1607cho/g7-comment-editor) when
formatting is present. **Also apply to comments** extends the same font size / line
height to the comment paragraph and to the comment box while writing (toolbar
headings included in the comment box); it's off by default and opt-in.

**Settings:** master on/off · base font size (px) · line height (multiplier) ·
also-apply-to-comments toggle.

### 6. Image paste

Two independent toggles, both on by default; turning one off does not affect the other:

- **Auto-upload pasted clipboard images** — right-click-copy or drag an image from
  another site and paste it into the post body editor; if the clipboard actually
  holds image binary data (not just an HTML reference to it), it's intercepted in
  the capture phase and uploaded through the existing local upload pipeline
  (CKEditor 5's standard `uploadImage` command → `sirsoft-ckeditor5`'s upload
  endpoint). No server-side re-fetching of the source URL is involved, so success
  doesn't depend on the source site's CORS/hotlink policy the way an earlier
  rehosting-based approach did (that approach was tried and dropped — see the
  `Plugin` class docblock in `plugin.php` for the history). Turning this off fully
  disables the interception (capture listener, the submit-lock guard below, upload)
  and falls back to `sirsoft-ckeditor5`'s own behavior — pasting a real screenshot
  still works either way, since that already goes through CKEditor 5's native paste
  handler independently of this toggle. The comment box is not affected (the comment
  editor has no image upload).
- **Auto-convert uploaded PNG images to WebP** — mitigates browsers re-encoding
  pasted images as PNG (which inflates file size) by re-compressing PNG uploads to
  WebP server-side: lossless first, falling back to high-quality lossy compression
  only if lossless doesn't help enough, and automatically keeping the original if
  the result would be larger. Applies to every image upload path on the site (post
  body editor, board/page attachments, admin attachments, template layout
  attachments), not just clipboard-pasted ones — a plain file-picker upload of a
  PNG gets the same treatment. Fully self-contained: the conversion engine and a
  small response middleware that keeps the downloaded filename's extension
  truthful (so "Save image as…" doesn't still suggest `.png` for a file that's
  actually WebP) both ship inside this plugin, hooking into filter points the
  host code already exposes rather than patching it — requires PHP's `imagick`
  extension, which is optional (falls back to a no-op if absent).

A related, general fix shipped alongside this feature (not gated by either toggle):
while an editor has an upload in flight, submitting the post ("글 작성 완료") is now
blocked until it finishes, using CKEditor 5's standard `PendingActions` plugin. This
closes a pre-existing gap that also affected plain screenshot pasting — submitting
mid-upload used to save the post with an empty `<img>`.

### 7. Code formatting

Adds two buttons to the **post** editor toolbar (not the comment editor): **Code**
right after *Strikethrough*, and **Code block** right after *Block quote*. They use
the Code and CodeBlock plugins that already ship in the installed CKEditor 5 build;
`sirsoft-ckeditor5` is not modified, and nothing else about typing changes (no
autoformat, no new shortcuts).

- Inline code is saved as `<code>…</code>`; a code block as
  `<pre><code class="language-plaintext">…</code></pre>` (plain text only, no
  syntax highlighting).
- Text inside code is shown as typed — Markdown marks are not converted there, and
  wiki plugins that skip `<code>` / `<pre>` (such as `g7-light-wiki`) leave `[[…]]`
  alone.
- Saved code is always styled for display (smaller monospace, soft background, long
  lines scroll sideways, a dark-mode palette), even when the buttons are turned off.
  Markdown code (`` `inline` `` and fenced blocks) uses the same look.
- Every code block in a viewed post (toolbar code blocks and Markdown ```` ``` ````
  blocks) gets a copy button in its top-right corner: half-transparent until hovered
  or focused, it stays put while the block scrolls sideways, copies the code exactly
  as shown and shows a check mark for 1.5 seconds. Inline code and the editors get
  no button, it is hidden when printing, and it does not depend on the setting.

## Settings screen

**Admin → Plugins → CKEditor 5 Superpack → Settings** shows a short description line
and seven tabs, one per feature. Each tab has a master on/off switch at the top
followed by that feature's detailed options:

- **SNS embeds** — per-platform on/off (YouTube · X · Instagram · TikTok) and the
  YouTube Shorts aspect ratio.
- **External link cards** — minimal-card on/off, thumbnail size, and the success /
  failure cache TTLs.
- **Local video upload** — max file size, chunk size, the `.mov` / `.webm` / `.m4v`
  extension toggles, and the auto-delete retention period, with a codec-compatibility
  note.
- **Markdown auto-convert** — a per-element on/off for headings, bold, italic (off by
  default), lists, links, code, blockquote, tables and horizontal rules.
- **Editor style** — base font size, line height, and the also-apply-to-comments
  toggle.
- **Image paste** — clipboard auto-upload on/off, PNG→WebP conversion on/off
  (independent of each other).
- **Code formatting** — show the Code / Code block buttons on/off (on by default).

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
- **PNG→WebP conversion needs PHP's `imagick` extension.** If it's not loaded, the
  conversion is silently skipped (PNGs are stored as-is) — no error, no crash.
- **Link cards: DNS lookup time is outside the 8-second budget.** Lookups use
  PHP's resolver, which has no per-call timeout. A slow DNS answer can make one
  link-preview request take longer than 8 s.
- **Link cards: non-UTF-8 pages** (e.g. EUC-KR) are not converted. Invalid bytes
  are replaced, so titles from such pages can show replacement characters.
- **Code blocks with a language class.** Plain text is the only code block language.
  An existing `<pre><code class="language-…">` opened and saved again in the editor
  keeps its class and also gets `language-plaintext`; the code text and its display
  are unchanged.

## Development

### Source layout

The front-end source lives in `resources/js/src/` as numbered pieces. They are
consecutive slices of one IIFE, so a piece is not a complete script on its own.
Names are sorted with `LC_ALL=C`, and the number band says what a piece is:

| Band | Pieces | Contents |
|---|---|---|
| `00` | `00-head.js` | Opens the IIFE, `IDENTIFIER`, `logger` |
| `01`–`09` | `01-settings`, `02-i18n`, `03-util`, `05-area`, `06-editors`, `06-registry`, `08-scheduler` | Core: settings (`readSettings`), `t`, shared helpers (`esc`, `authToken`, `warnOnce`, …), editing-area helpers, the section registry and the scheduler |
| `10`–`79` | `10`/`11` Markdown, `20`/`21` SNS embeds, `30` link cards, `40`–`42` video, `50`/`51` image paste and upload guards, `60` editor style, `70` code formatting, `71` code copy | Feature sections. Ten numbers per feature; a one-digit step is a sub-file of the same feature |
| `80`–`89` | — | Spare |
| `90` | `90-boot.js` | Boot (`init`, handler registration, `window.__G7Ckeditor5Superpack`) |
| `99` | `99-tail.js` | Closes the IIFE |

- `scripts/build-js.sh` joins the pieces in name order and writes the result to both
  `dist/js/plugin.iife.js` and `resources/js/index.js` (the two files are always
  identical). `scripts/build-js.sh --check` writes nothing and exits `1` if either
  file is out of date.
- After editing a piece, always run `scripts/build-js.sh` and commit the rebuilt
  files. No npm or bundler is involved. `scripts/` is not included in release
  archives.

### Core, registry and scheduler

- `core` is a local object inside the IIFE. The only `window` names the script
  touches are `window.__G7Ckeditor5Superpack` (with `rescan()`) and the
  `window.CKEDITOR` accessor used by code formatting. `core` has `core.id`,
  `core.section(spec)` and `core.ns(name)` (a shared object for pieces of the same
  feature).
- Each section registers itself with `core.section({...})` at the end of its piece.
  The fields are `name`, `scope` (`visitor` / `editor` / `both`), `order` (visitor
  pass), `editorOrder` (editor pass), `load`, `gate`, `enabled`, `styles` and the
  hooks `install`, `boot`, `visitor`, `visitorEnd`, `editor`, `editorEnd`.
  `settings` and `guard` are accepted but not used yet.
  - `visitor(scope, cfg, ctx)` runs once per visitor `.ck-content` (editing areas
    are skipped), in `order`. `ctx.once(key, fn)` and `ctx.has(key)` share state
    within one scan. `visitorEnd(ctx, cfg)` runs after the scan.
  - `gate(cfg)`: if no section's gate is true, the page scan runs only the sections
    without a gate, once on the root (today that is code copy).
  - `editor(container)` runs once per post-editor container that has a live editor,
    in `editorOrder`. `editorEnd()` runs after each editor scan. `boot(cfg)` runs
    once when the script starts. `install()` runs immediately at registration, while
    the script is loading.
  - `load` accepts only `'eager'` in 1.6.0. It is a placeholder for lazy-loaded
    sections later.
- Current order: visitor pass `markdown` 10 → `code-copy` 20 → `video-render` 30 →
  `sns-embed` 40 → `link-card` 50; editor pass `video-upload` 10 → `image-paste` 20 →
  `upload-guards` 30; `editor-style` has `boot` and `editorEnd`; `code-format` has
  `install`. A section that reads another section's result must use a larger order.
- The scheduler (`08-scheduler.js`) owns the only MutationObserver (on
  `document.body`, `childList` + `subtree`). An added node that is, is inside, or
  contains `.ck-content` requests a visitor scan after 200 ms, restarted on every
  such change. Every change requests an editor scan after 250 ms, a fixed window
  that ignores changes while it is pending. Boot runs both scans after two animation
  frames, then again at 400 ms and 900 ms. Sections must not add their own observers
  or scan timers.
- Safety rule: if a hook throws, only that section is skipped and
  `warnOnce(tag, reason)` logs a single `console.warn`; the rest keeps running. A
  section that touches the editor should also do nothing and leave the editor as it
  is when the structure is not what it expects.

### Adding a feature section

1. Pick a free number in the section band (10–79) and create
   `resources/js/src/NN-<name>.js`. Wrap the whole file in
   `(function (core) { 'use strict'; … })(core);` and end it with one
   `core.section({ … })` call. Do not create top-level names outside the wrapper.
   Share anything another piece needs through `core.ns('<feature>')` only. (Sections
   written before 1.6.0 are not wrapped yet; they will be wrapped one at a time when
   needed.)
2. Fill the entry: `name`, `scope`, `order` and/or `editorOrder`, `load: 'eager'`,
   `gate` and `enabled` if the section has an on/off setting, `styles` (the
   `<style>` ids it creates) and the hooks it needs.
3. Use the core helpers (`readSettings`, `t`, `esc`, `warnOnce`, `isEditingArea`,
   `editorInstanceNear`, …) instead of your own copies. Do not add MutationObservers
   or scan timers.
4. If the section has settings, update all eight places:
   1. `plugin.php` `getSettingsSchema()` (type, default, labels)
   2. `plugin.php` `getConfigValues()` default values
   3. `config/settings/defaults.json` `defaults`
   4. `config/settings/defaults.json` `frontend_schema` (`expose: true` for values
      the script reads)
   5. `resources/layouts/admin/plugin_settings.json` tab button
   6. `resources/layouts/admin/plugin_settings.json` tab panel (fields and hints)
   7. `resources/layouts/admin/plugin_settings.json` form `schema`
   8. `resources/lang/ko.json` and `resources/lang/en.json` keys (tab, fields,
      hints)

   Then read the new key in `readSettings()` (`01-settings.js`).
5. Run `scripts/build-js.sh` and `scripts/build-js.sh --check`, and commit the piece
   together with both built files.
6. Add the section to the order list above, the feature list and CHANGELOG.

## <a name="사용법-한국어"></a>사용법 (한국어)

**관리자 → 플러그인 → CKEditor 5 슈퍼팩 → 설정** 으로 이동합니다. 탭 7개, 기능별로 하나씩.

- **SNS 임베드** — 본문에 YouTube·X·Instagram·TikTok 링크를 **한 줄에 단독으로** 붙여넣으면
  방문자 화면에서 임베드로 표시됩니다. 임베드 아래에는 항상 원문 링크 버튼이 남습니다.
  설정: 전체 온/오프 · 플랫폼별 온/오프 · YouTube Shorts 세로 비율.
- **외부 링크 카드화** — 임베드 대상이 아닌 일반 외부 링크를 대표이미지+제목+요약+도메인
  카드(또는 파비콘+제목+도메인 최소 카드)로 바꿉니다. 메타 취득은 서버가 대행하고 캐시합니다.
  설정: 전체 온/오프 · 최소 카드 온/오프 · 이미지 크기 · 성공/실패 캐시 보존기간.
  최소 카드의 파비콘은 불러오기에 성공했을 때만 보입니다(막힌 아이콘 때문에 카드가 다시 그려지지 않음).
  편집 화면 안의 링크는 링크 그대로 두고, 카드는 방문자 화면에서만 만듭니다.
  요청 한도(1.5.0): 링크 프리뷰 API는 슈퍼팩 전용 제한기로 IP당 분당 60회이며, 다른 API와 따로 셉니다.
  429를 받으면 `Retry-After`(10초 이하, 없으면 2초) 뒤 한 번 다시 요청하고, 같은 주소 카드는 요청을
  함께 씁니다. 리버스 프록시 뒤라면 코어 `.env`의 `TRUSTED_PROXIES`를 설정해야 방문자별로 셉니다.
  서버 보호장치(1.4.0):
  - 내부망·CGNAT(Tailscale 등)·IPv4-mapped 주소와 숫자형 IP 표기를 매 홉마다 차단합니다.
  - 판정한 IP로 접속을 고정하고, 프록시 환경변수는 무시합니다.
  - 압축 응답과 HTML이 아닌 응답은 받지 않습니다. 본문은 1 MiB까지만 받고, 전체 대기 시간은 8초입니다.
  - 실제 외부 요청 빈도를 제한합니다(사이트 전체 분당 120회, 대상 호스트당 분당 20회).
    한도를 넘으면 실패로 응답하고 캐시에 남기지 않습니다.
  - 캐시 정리 명령 `g7-ckeditor5-superpack:prune-link-previews`가 매일 실행됩니다.
    보존기간이 지난 행을 지우고, 테이블을 최대 5만 행으로 유지합니다.
    `--dry-run`을 붙이면 지우지 않고 건수만 봅니다.
- **로컬 동영상 업로드** — 에디터 위 "동영상 업로드" 버튼으로 MP4/MOV/WebM 을 청크 업로드합니다.
  편집 화면의 미디어 라이브러리에서 카드를 클릭하면 커서 위치에 삽입되고, S/M/L 크기를 고를 수
  있습니다. 방문자 화면에서는 링크가 재생 플레이어로 바뀝니다. `.mp4` 는 항상, `.mov`·`.webm` 은
  기본 허용, `.m4v` 는 옵트인. 확장자와 실제 매직바이트가 일치해야 통과합니다. HEVC(H.265) `.mov`
  는 일부 브라우저에서 재생되지 않습니다(트랜스코딩 없음). 자동 삭제 보관기간은 기본 0(무기한).
- **마크다운 자동 변환** — 붙여넣은 `##`, `**굵게**` 같은 기호를 방문자 화면에서 실제 서식으로
  바꿉니다. 본문 원문은 그대로 저장됩니다. 지원: 제목 / 굵게 / 기울임(기본 OFF) / 목록(2줄 이상
  연속) / 링크 / 코드 / 인용구 / 표(GFM, 첫 행은 헤더) / 구분선(`---`, 항상 `<hr>`, 끄면 원문 글자 그대로),
  요소별 온/오프. `#태그`(공백 없음)·`####`·단일 `- 문장`·`2024.`
  같은 것은 변환하지 않습니다.
- **에디터 스타일** — 게시글 본문의 기본 글자크기(12~28px)·줄간격(1.2~2.0)을 사이트 전체에
  일괄 적용합니다(기본 OFF). 이미 작성된 글에도 함께 적용되고, 편집 중 포커스가 바뀌어도 유지됩니다.
  켜져 있으면 툴바 제목(제목 1·2·3 = `h2`·`h3`·`h4`)이 본문의 1.5·1.3·1.15배, 굵게, 제목용 줄간격·
  여백으로 보입니다(글자 크기 도구로 준 크기가 우선, 마크다운 제목은 자기 스타일 유지). 댓글은 게시글
  본문과 렌더링 경로가 달라(댓글은 텍스트로 저장되고 `g7-comment-editor` 가 클라이언트에서 서식을
  승격) 기본 적용 대상이 아니며, "댓글에도 동일하게 적용" 옵션을 켜면 방문자 화면의 댓글과 **댓글
  입력창**에 함께 적용됩니다(옵션이 꺼져 있으면 댓글 입력창에도 적용되지 않음).
- **이미지 복붙** — 서로 독립된 체크박스 2개(둘 다 기본 ON).
  - **클립보드 이미지 자동 업로드** — 타 사이트에서 이미지를 우클릭 복사/드래그해 본문
    에디터에 붙여넣으면(클립보드에 실제 이미지 바이너리가 있을 때) 기존 로컬 업로드
    경로(CKEditor5 표준 `uploadImage` 커맨드)로 그대로 업로드합니다. 외부 URL을 서버가
    대신 재요청하는 방식이 아니라서 사이트별 CORS/핫링크 정책에 성공 여부가 좌우되지
    않습니다(과거 재호스팅 방식은 이 문제로 폐기됨 — `plugin.php`의 `Plugin` 클래스
    docblock 참고). 끄면 가로채기 전체가 비활성화되고 `sirsoft-ckeditor5` 기본 동작으로
    돌아갑니다 — 스크린샷 붙여넣기는 이 설정과 무관하게 계속 동작합니다. 댓글 입력창은 대상이
    아닙니다(댓글 에디터에는 이미지 업로드가 없음).
  - **업로드 이미지 PNG→WebP 자동 변환** — 브라우저가 붙여넣은 이미지를 PNG로 재구성해
    용량이 커지는 문제를 완화하기 위해, 서버가 PNG를 WebP로 재압축합니다(무손실 우선 →
    이득이 적으면 고품질 손실 압축 폴백 → 그래도 원본보다 크면 자동으로 원본 유지).
    클립보드 붙여넣기뿐 아니라 사이트의 모든 이미지 업로드 경로(게시글 본문·게시판/
    페이지 첨부·관리자 첨부·템플릿 레이아웃 첨부)에 적용되며, 변환 엔진과 다운로드
    파일명 보정(변환 후에도 "다른 이름으로 저장"이 여전히 `.png`를 제안하지 않도록)
    미들웨어 전부 이 플러그인 안에 완결돼 있습니다 — g7 코어나 다른 플러그인을 전혀
    수정하지 않고 훅으로만 연결됩니다. PHP `imagick` 확장이 필요하며(옵셔널, 없으면
    조용히 변환을 건너뜀), 그 외 별도 서버 패치는 필요 없습니다.
  - 두 체크박스와 무관하게 함께 딸려온 수정: 이미지 업로드가 끝나기 전에 "글 작성 완료"를
    누르면 본문 이미지가 빈칸으로 저장되던 기존 결함을 `PendingActions` 연동으로 막았습니다
    (스크린샷 붙여넣기 경로에도 소급 적용).
- **코드 서식** — 게시글 본문 에디터 툴바에 **코드**(취소선 뒤)·**코드 블록**(인용 뒤) 버튼을
  더합니다(댓글 에디터는 대상 아님). 설치된 CKEditor 빌드의 Code·CodeBlock 플러그인을 쓰며
  `sirsoft-ckeditor5`는 고치지 않습니다. 자동 변환·단축키는 넣지 않습니다. 인라인 코드는
  `<code>`, 코드 블록은 `<pre><code class="language-plaintext">`(일반 텍스트, 문법 강조 없음)로
  저장되어, 코드 안의 글자는 마크다운 변환이나 위키 링크(`[[…]]`)로 바뀌지 않고 그대로 보입니다.
  설정: 버튼 온/오프(기본 ON). 끄면 버튼만 사라지고 이미 저장된 코드의 표시 스타일은 그대로입니다.
  마크다운 코드(`` `인라인` ``·```` ``` ```` 블록)도 툴바 코드와 같은 모양으로 보입니다.
  글 보기 화면의 코드 블록(툴바 코드 블록·마크다운 ```` ``` ```` 블록)에는 오른쪽 위에 반투명 복사
  버튼이 붙습니다. 가로 스크롤해도 제자리에 있고, 들여쓰기·탭까지 그대로 복사하며, 복사되면
  1.5초간 체크 표시로 바뀝니다. 인라인 코드·편집기에는 붙지 않고, 인쇄 시 숨겨지며, 설정과
  무관하게 항상 표시됩니다.

각 기능을 끄면 해당 처리를 완전히 건너뜁니다. `sirsoft-ckeditor5` 는 전혀 수정하지 않습니다.

### 개발

#### 소스 구성

프런트 소스는 `resources/js/src/`에 번호 붙은 조각으로 있습니다. 조각은 하나의 IIFE를 이어서 자른 것이라,
조각 하나만으로는 완결된 스크립트가 아닙니다. 이름 정렬은 `LC_ALL=C` 기준이고, 번호 대역이 조각의 역할을 나타냅니다.

| 대역 | 조각 | 내용 |
|---|---|---|
| `00` | `00-head.js` | IIFE 열기, `IDENTIFIER`, `logger` |
| `01`~`09` | `01-settings`, `02-i18n`, `03-util`, `05-area`, `06-editors`, `06-registry`, `08-scheduler` | 코어: 설정(`readSettings`), `t`, 공용 도우미(`esc`·`authToken`·`warnOnce` 등), 편집 영역 도우미, 섹션 등록부, 스케줄러 |
| `10`~`79` | `10`·`11` 마크다운, `20`·`21` SNS 임베드, `30` 링크 카드, `40`~`42` 동영상, `50`·`51` 이미지 붙여넣기·업로드 보호, `60` 에디터 스타일, `70` 코드 서식, `71` 코드 복사 | 기능 섹션. 기능마다 10 단위, 한 자리 차이는 같은 기능의 부속 파일 |
| `80`~`89` | — | 예비 |
| `90` | `90-boot.js` | 부팅(`init`, 핸들러 등록, `window.__G7Ckeditor5Superpack`) |
| `99` | `99-tail.js` | IIFE 닫기 |

- `scripts/build-js.sh`가 조각을 이름 순으로 이어 붙여 `dist/js/plugin.iife.js`와
  `resources/js/index.js` 두 곳에 씁니다(두 파일은 항상 같습니다). `--check`를 붙이면 파일을
  쓰지 않고, 어느 한쪽이라도 결합 결과와 다르면 `1`로 끝납니다.
- 조각을 고친 뒤에는 반드시 `scripts/build-js.sh`를 실행하고 다시 만든 파일을 함께
  커밋합니다. npm·번들러는 쓰지 않습니다. `scripts/`는 릴리스 압축 파일에 들어가지 않습니다.

#### 코어·등록부·스케줄러

- `core`는 IIFE 안의 지역 객체입니다. 스크립트가 건드리는 `window` 이름은 `window.__G7Ckeditor5Superpack`(`rescan()`)와
  코드 서식이 쓰는 `window.CKEDITOR` 접근자뿐입니다. `core`에는 `core.id`, `core.section(spec)`,
  `core.ns(name)`(같은 기능의 조각끼리 나누는 객체)이 있습니다.
- 각 섹션은 자기 조각 끝에서 `core.section({...})`으로 등록합니다. 항목은 `name`, `scope`(`visitor`·`editor`·`both`),
  `order`(방문자 순서), `editorOrder`(편집기 순서), `load`, `gate`, `enabled`, `styles`와 훅
  `install`·`boot`·`visitor`·`visitorEnd`·`editor`·`editorEnd`입니다. `settings`·`guard`는 받기만 하고 아직 쓰지 않습니다.
  - `visitor(scope, cfg, ctx)`는 방문자 `.ck-content`마다(편집 영역 제외) `order` 순으로 불립니다.
    `ctx.once(key, fn)`·`ctx.has(key)`로 스캔 한 번 동안 상태를 나눕니다. `visitorEnd(ctx, cfg)`는 스캔 끝에 불립니다.
  - `gate(cfg)`: 게이트가 참인 섹션이 하나도 없으면, 게이트가 없는 섹션만 문서 전체에 한 번 돕니다(지금은 코드 복사).
  - `editor(container)`는 편집기가 살아 있는 게시글 본문 에디터 컨테이너마다 `editorOrder` 순으로 불립니다.
    `editorEnd()`는 편집기 스캔마다 끝에 불립니다. `boot(cfg)`는 시작할 때 한 번, `install()`은 등록하는 즉시(스크립트를 불러오는 중에) 불립니다.
  - `load`는 1.6.0에서 `'eager'`만 받습니다. 나중에 섹션을 늦게 불러올 자리입니다.
- 지금 순서: 방문자 `markdown` 10 → `code-copy` 20 → `video-render` 30 → `sns-embed` 40 → `link-card` 50,
  편집기 `video-upload` 10 → `image-paste` 20 → `upload-guards` 30. `editor-style`은 `boot`·`editorEnd`,
  `code-format`은 `install`을 씁니다. 다른 섹션의 결과를 읽는 섹션은 그보다 큰 순서 값을 씁니다.
- 스케줄러(`08-scheduler.js`)가 유일한 MutationObserver(`document.body`, `childList` + `subtree`)를 가집니다.
  `.ck-content`이거나 그 안이거나 그것을 품은 노드가 추가되면 방문자 스캔을 200ms 뒤로 요청하고, 그런 변경마다 다시 잡습니다.
  모든 변경은 편집기 스캔을 250ms 뒤로 요청합니다(대기 중에는 새 요청을 버리는 고정 창).
  부팅 때는 애니메이션 프레임 두 번 뒤, 그리고 400ms·900ms에 두 스캔을 돕니다. 섹션은 감시기나 스캔 타이머를 따로 만들지 않습니다.
- 안전장치 규칙: 훅이 예외를 내면 그 섹션만 건너뛰고 `warnOnce(tag, reason)`가 `console.warn`을 한 번 남기며,
  나머지는 계속 돕니다. 편집기에 개입하는 섹션은 구조가 예상과 다르면 아무것도 하지 않고 에디터를 원래대로 둡니다.

#### 기능 섹션 추가 절차

1. 섹션 대역(10~79)에서 빈 번호를 골라 `resources/js/src/NN-<이름>.js`를 만듭니다. 파일 전체를
   `(function (core) { 'use strict'; … })(core);`로 감싸고 끝에서 `core.section({ … })`을 한 번 부릅니다.
   감싼 범위 밖에 최상위 이름을 만들지 않고, 다른 조각과 나눌 것은 `core.ns('<기능>')`로만 주고받습니다.
   (1.6.0 이전에 만든 섹션은 아직 감싸지 않았습니다. 필요할 때 섹션 단위로 감쌉니다.)
2. 등록 항목을 채웁니다: `name`, `scope`, `order`·`editorOrder`, `load: 'eager'`, 켜고 끄는 설정이 있으면 `gate`·`enabled`,
   `styles`(만드는 `<style>` id), 필요한 훅.
3. 도우미는 새로 만들지 말고 코어의 것(`readSettings`·`t`·`esc`·`warnOnce`·`isEditingArea`·`editorInstanceNear` 등)을 씁니다.
   MutationObserver나 스캔 타이머를 새로 만들지 않습니다.
4. 설정이 있으면 여덟 곳을 모두 고칩니다.
   1. `plugin.php` `getSettingsSchema()`(형식·기본값·라벨)
   2. `plugin.php` `getConfigValues()` 기본값
   3. `config/settings/defaults.json` `defaults`
   4. `config/settings/defaults.json` `frontend_schema`(스크립트가 읽는 값은 `expose: true`)
   5. `resources/layouts/admin/plugin_settings.json` 탭 버튼
   6. `resources/layouts/admin/plugin_settings.json` 탭 패널(입력 칸·도움말)
   7. `resources/layouts/admin/plugin_settings.json` 폼 `schema`
   8. `resources/lang/ko.json`·`resources/lang/en.json` 키(탭·입력 칸·도움말)

   그다음 `readSettings()`(`01-settings.js`)에서 새 키를 읽습니다.
5. `scripts/build-js.sh`, `scripts/build-js.sh --check`를 돌리고, 조각과 빌드된 두 파일을 함께 커밋합니다.
6. 위 순서 목록, 기능 목록, CHANGELOG에 섹션을 적습니다.

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
