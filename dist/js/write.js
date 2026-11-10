/**
 * g7-ckeditor5-superpack — 글쓰기 도우미 묶음 (1.7.0, 지연 로드: dist/js/write.js)
 *
 * 관리자 설정 "글쓰기 도우미" 탭의 기능(임시 저장·글자 수) 중 하나라도 켜져 있고, 로그인한 사용자가
 * 사용자 글쓰기·수정 화면(`/board/<slug>/write`, `/board/<slug>/<id>/edit`)에 있을 때만 불러온다.
 * 대상은 게시글 본문 에디터(`.ckeditor5-wrapper`)뿐이다. 댓글 에디터(g7-comment-editor)는 대상이 아니다.
 *
 * 조각 구성은 전역 스크립트와 같다(`00` 열기 · `10~79` 기능 · `99` 닫기, scripts/build-js.sh 가 이어 붙임).
 */
(function () {
  'use strict';

  var api = window.__G7Ckeditor5Superpack;
  if (!api || typeof api.chunk !== 'function') return;

  api.chunk('write', function (core) {
  /* ================================================================ *
   *  C2 글자 수 (1.7.0)
   * ================================================================ *
   *  게시글 본문 에디터(사용자 글쓰기·수정 화면) 아래에 "글자 N · 공백 제외 M" 한 줄.
   *  - 세는 시점은 빌드 내장 WordCount 플러그인의 `update` 이벤트(플러그인이 알아서 간격을 둔다).
   *    WordCount 는 전역 스크립트가 에디터 생성 때 넣는다(07-chunks). 없으면(설정을 늦게 안 경우) 자체로
   *    `change:data` 를 300ms 간격으로 센다.
   *  - 글자는 에디터 모델의 글자 노드를 모아 센다(문단 사이는 세지 않음). 이모지 등 합쳐진 글자는
   *    코드 포인트 단위다(순수 함수 `core.ns('count').countChars`).
   *  - 댓글 에디터는 `.ckeditor5-wrapper` 밖이라 편집기 스캔 대상이 아니다.
   */
  (function (core) {
    'use strict';

    var STYLE_ID = 'ck5sp-count-style';
    var done = typeof WeakSet !== 'undefined' ? new WeakSet() : null;

    /** 글자 수(공백 포함·제외, 코드 포인트 단위) — 순수 */
    function countChars(text) {
      var s = String(text == null ? '' : text);
      var all = Array.from ? Array.from(s).length : s.length;
      var noSpace = s.replace(/\s+/g, '');
      var ns = Array.from ? Array.from(noSpace).length : noSpace.length;
      return { withSpaces: all, withoutSpaces: ns };
    }

    function fmt(n) {
      try { return Number(n).toLocaleString(); } catch (e) { return String(n); }
    }

    function label(c) {
      return core.t('editor.count.label', '글자 {all} · 공백 제외 {nospace}')
        .replace('{all}', fmt(c.withSpaces))
        .replace('{nospace}', fmt(c.withoutSpaces));
    }

    core.ns('count').countChars = countChars;
    core.ns('count').label = label;

    /** 에디터 모델의 글자를 모은다(문단 경계는 이어 붙이지 않는다) */
    function modelText(editor) {
      var model = editor.model;
      var root = model.document.getRoot();
      var it = model.createRangeIn(root).getItems();
      var out = '';
      var r;
      while (!(r = it.next()).done) {
        var item = r.value;
        if (item && item.is && (item.is('$textProxy') || item.is('$text'))) out += item.data;
      }
      return out;
    }

    function injectStyle() {
      if (document.getElementById(STYLE_ID)) return;
      var el = document.createElement('style');
      el.id = STYLE_ID;
      el.textContent = ''
        + '.ck5sp-count{margin-top:.35em;text-align:right;font-size:.75rem;line-height:1.4;color:#6b7280;font-variant-numeric:tabular-nums;}'
        + 'html.dark .ck5sp-count{color:#9ca3af;}';
      document.head.appendChild(el);
    }

    function attach(container) {
      var c = core.writeConfig && core.writeConfig();
      if (!c || !c.count) return;
      var editor = core.editorInstanceNear(container);
      if (!editor || !editor.model) return;
      if (done) { if (done.has(editor)) return; done.add(editor); } else if (editor.__ck5spCount) return;
      editor.__ck5spCount = true;
      // 업로드 바(42-video-library)처럼 에디터 컨테이너의 형제로 둔다(컨테이너 안은 sirsoft·CKEditor 소관)
      var parent = container.parentNode;
      if (!parent) return;
      var nextEl = container.nextElementSibling;
      if (nextEl && nextEl.getAttribute('data-ck5sp-write') === 'count') return;
      injectStyle();
      var line = document.createElement('div');
      line.className = 'ck5sp-count';
      line.setAttribute('data-ck5sp-write', 'count');
      line.setAttribute('aria-live', 'polite');
      parent.insertBefore(line, container.nextSibling);
      var update = function () {
        try { line.textContent = label(countChars(modelText(editor))); } catch (e) { core.warnOnce('count', e); }
      };
      update();
      var wc = null;
      try { wc = editor.plugins.has('WordCount') ? editor.plugins.get('WordCount') : null; } catch (e) { wc = null; }
      if (wc && wc.on) {
        wc.on('update', update);
      } else {
        var timer = null;
        editor.model.document.on('change:data', function () {
          if (timer !== null) return;
          timer = window.setTimeout(function () { timer = null; update(); }, 300);
        });
      }
    }

    core.section({
      name: 'write-count',
      scope: 'editor',
      editorOrder: 50,
      load: 'chunk',
      editor: function (container) { attach(container); }
    });
  })(core);

  /* ================================================================ *
   *  C1 임시 저장·복구 (1.7.0)
   * ================================================================ *
   *  로그인한 사용자가 사용자 글쓰기·수정 화면에서 글을 쓰는 동안 제목·본문을 이 브라우저(localStorage)에
   *  저장하고, 다시 열면 에디터 위에 "임시 저장된 글이 있습니다 [복구] [버리기]" 를 보여 준다.
   *  - CKEditor 내장 Autosave 는 쓰지 않는다: 저장 대기 중 PendingActions 를 잡아 업로드 보호(51)가
   *    제출 버튼을 막는다. 대신 `change:data` 를 SAVE_DELAY_MS 간격으로 모아 저장한다.
   *  - 업로드가 진행 중(PendingActions.hasAny)이면 저장을 미룬다(빈 자리표시 이미지가 저장되지 않게).
   *  - 비밀글 칸이 체크돼 있으면(또는 게시판이 항상 비밀글) 저장하지 않고 남은 임시본도 지운다.
   *  - 저장 키: `g7sp:draft:v1:<사용자 해시>:<게시판>:<글 id|new>[:p<부모 id>]`.
   *    만료 7일, 글 하나 500KB(UTF-8 바이트), 이 사용자 기준 최대 10개(넘으면 오래된 것부터).
   *  - 제출 성공: 저장 버튼을 누른 뒤 SUBMIT_WINDOW_MS 안에 글쓰기 경로를 벗어나 글 상세 경로로 가면
   *    그 키를 지운다(실패하면 같은 화면에 남으므로 지우지 않는다. 취소는 저장 버튼이 아니므로 남는다).
   *  - 대상은 게시글 본문 에디터(`.ckeditor5-wrapper`)뿐이다. 댓글 에디터는 편집기 스캔 대상이 아니다.
   */
  (function (core) {
    'use strict';

    var PREFIX = 'g7sp:draft:v1:';
    var MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
    var MAX_BYTES = 500 * 1024;
    var MAX_DRAFTS = 10;
    var SAVE_DELAY_MS = 1500;
    var SUBMIT_WINDOW_MS = 30 * 1000;
    var SUBMIT_KEY = 'g7sp:draft-submit:v1';
    var STYLE_ID = 'ck5sp-draft-style';
    var attached = typeof WeakSet !== 'undefined' ? new WeakSet() : null;

    /* ---- 순수 함수 ---- */

    /**
     * 저장 키. 글쓰기 경로가 아니거나 사용자 해시가 없으면 null.
     * @param {string} user  사용자 구분 해시
     * @param {string} pathname  location.pathname
     * @param {string} search  location.search
     */
    function draftKey(user, pathname, search) {
      if (!user || !/^[A-Za-z0-9_-]{1,64}$/.test(user)) return null;
      var p = String(pathname || '').replace(/\/+$/, '');
      var m = p.match(/^\/board\/([^/]+)\/write$/) || p.match(/^\/board\/([^/]+)\/([^/]+)\/edit$/);
      if (!m) return null;
      var slug = m[1];
      var id = m[2] || 'new';
      var parent = '';
      var q = String(search || '').match(/[?&]parent_id=([^&#]*)/);
      if (q && q[1]) parent = ':p' + decodeURIComponent(q[1]).replace(/[^\w-]/g, '').slice(0, 40);
      return PREFIX + user + ':' + slug.slice(0, 80) + ':' + id.slice(0, 80) + parent;
    }

    /** UTF-8 바이트 수 */
    function byteLength(s) {
      s = String(s);
      if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s).length;
      return unescape(encodeURIComponent(s)).length;
    }

    /**
     * 지울 키 목록(순수): 만료된 것(모든 사용자), 깨진 값, 이 사용자 것 중 최신 keep 개를 넘는 것.
     * @param {Array<{key:string,t:number|null}>} entries  t 가 null 이면 읽을 수 없는 값
     * @param {number} now
     * @param {string} user
     * @param {number} keep  이 사용자에게 남길 최대 개수(새로 저장할 자리를 비우려면 MAX_DRAFTS-1)
     */
    function pruneKeys(entries, now, user, keep) {
      var del = [];
      var mine = [];
      var mineP = PREFIX + user + ':';
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (e.t === null || typeof e.t !== 'number' || now - e.t > MAX_AGE_MS) { del.push(e.key); continue; }
        if (user && e.key.indexOf(mineP) === 0) mine.push(e);
      }
      mine.sort(function (a, b) { return b.t - a.t; });
      for (var j = keep; j < mine.length; j++) del.push(mine[j].key);
      return del;
    }

    /** 짧은 내용 지문(djb2) — 수정 화면의 원문이 그 사이 바뀌었는지 보는 데만 쓴다 */
    function fingerprint(s) {
      var h = 5381;
      s = String(s || '');
      for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
      return (h >>> 0).toString(36) + ':' + s.length;
    }

    var ns = core.ns('draft');
    ns.draftKey = draftKey;
    ns.pruneKeys = pruneKeys;
    ns.byteLength = byteLength;
    ns.fingerprint = fingerprint;
    ns.MAX_AGE_MS = MAX_AGE_MS;
    ns.MAX_BYTES = MAX_BYTES;
    ns.MAX_DRAFTS = MAX_DRAFTS;

    /* ---- 저장소 ---- */

    function ls() {
      try { return window.localStorage || null; } catch (e) { return null; }
    }

    function readDraft(key) {
      var s = ls();
      if (!s) return null;
      try {
        var o = JSON.parse(s.getItem(key) || 'null');
        if (!o || typeof o.t !== 'number' || Date.now() - o.t > MAX_AGE_MS) return null;
        return o;
      } catch (e) { return null; }
    }

    function removeDraft(key) {
      var s = ls();
      if (!s || !key) return;
      try { s.removeItem(key); } catch (e) {}
    }

    function allEntries() {
      var s = ls();
      var out = [];
      if (!s) return out;
      try {
        for (var i = 0; i < s.length; i++) {
          var k = s.key(i);
          if (!k || k.indexOf(PREFIX) !== 0) continue;
          var t = null;
          try { var o = JSON.parse(s.getItem(k) || 'null'); t = o && typeof o.t === 'number' ? o.t : null; } catch (e) { t = null; }
          out.push({ key: k, t: t });
        }
      } catch (e) {}
      return out;
    }

    function prune(user, keep) {
      var keys = pruneKeys(allEntries(), Date.now(), user, keep);
      for (var i = 0; i < keys.length; i++) removeDraft(keys[i]);
    }

    function writeDraft(key, user, value) {
      var s = ls();
      if (!s) return false;
      var json = JSON.stringify(value);
      if (byteLength(json) > MAX_BYTES) { removeDraft(key); return false; }
      if (!readDraft(key)) prune(user, MAX_DRAFTS - 1);
      try { s.setItem(key, json); return true; } catch (e) { return false; }
    }

    /* ---- 화면 ---- */

    function formOf(container) {
      return container.closest('#form') || container.closest('form') || document;
    }

    /** 비밀글 칸이 켜져 있으면 true(체크박스 또는 항상 비밀글 모드의 숨은 값) */
    function isPrivate(form) {
      var boxes = form.querySelectorAll('input[name="is_secret"]');
      for (var i = 0; i < boxes.length; i++) {
        var b = boxes[i];
        if (b.type === 'checkbox' && b.checked) return true;
        if (b.type === 'hidden' && String(b.value).toLowerCase() === 'true') return true;
      }
      return false;
    }

    function titleInput(form) {
      return form.querySelector('input[name="title"]');
    }

    /** React 가 관리하는 입력 칸에 값을 넣는다(값 설정자 + input 이벤트). */
    function setReactInput(input, value) {
      try {
        var proto = Object.getPrototypeOf(input);
        var desc = Object.getOwnPropertyDescriptor(proto, 'value') || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        if (desc && desc.set) desc.set.call(input, value);
        else input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      } catch (e) { core.warnOnce('draft title', e); }
    }

    function pendingUpload(editor) {
      try {
        var pa = editor.plugins.get('PendingActions');
        return !!(pa && pa.hasAny);
      } catch (e) { return false; }
    }

    function injectStyle() {
      if (document.getElementById(STYLE_ID)) return;
      var el = document.createElement('style');
      el.id = STYLE_ID;
      el.textContent = ''
        + '.ck5sp-draft{display:flex;flex-wrap:wrap;align-items:center;gap:.5em .75em;margin:0 0 .6em;padding:.55em .8em;border:1px solid #fcd34d;border-radius:8px;background:#fffbeb;color:#78350f;font-size:.8125rem;line-height:1.4;}'
        + '.ck5sp-draft__msg{flex:1 1 14em;}'
        + '.ck5sp-draft button{padding:.25em .8em;border-radius:6px;border:1px solid #d97706;background:#fff;color:#92400e;font:inherit;font-weight:600;cursor:pointer;}'
        + '.ck5sp-draft button[data-act="restore"]{background:#d97706;color:#fff;}'
        + '.ck5sp-draft button:focus-visible{outline:2px solid #60a5fa;outline-offset:2px;}'
        + 'html.dark .ck5sp-draft{background:#3b2a0b;border-color:#92400e;color:#fde68a;}'
        + 'html.dark .ck5sp-draft button{background:#1f2937;color:#fde68a;border-color:#b45309;}'
        + 'html.dark .ck5sp-draft button[data-act="restore"]{background:#b45309;color:#fff;}';
      document.head.appendChild(el);
    }

    function fmtTime(t) {
      try { return new Date(t).toLocaleString(); } catch (e) { return ''; }
    }

    function showBar(container, draft, changed, onRestore, onDiscard) {
      var parent = container.parentNode;
      if (!parent) return null;
      injectStyle();
      var bar = document.createElement('div');
      bar.className = 'ck5sp-draft';
      bar.setAttribute('data-ck5sp-write', 'draft');
      bar.setAttribute('role', 'status');
      var msg = document.createElement('span');
      msg.className = 'ck5sp-draft__msg';
      msg.textContent = core.t(changed ? 'editor.draft.found_changed' : 'editor.draft.found',
        changed ? '임시 저장된 글이 있습니다({time}). 그 뒤에 이 글이 다른 곳에서 수정되었을 수 있습니다.' : '임시 저장된 글이 있습니다({time}).')
        .replace('{time}', fmtTime(draft.t));
      var restore = document.createElement('button');
      restore.type = 'button';
      restore.setAttribute('data-act', 'restore');
      restore.textContent = core.t('editor.draft.restore', '복구');
      var discard = document.createElement('button');
      discard.type = 'button';
      discard.setAttribute('data-act', 'discard');
      discard.textContent = core.t('editor.draft.discard', '버리기');
      bar.appendChild(msg);
      bar.appendChild(restore);
      bar.appendChild(discard);
      restore.addEventListener('click', function () { onRestore(); bar.remove(); });
      discard.addEventListener('click', function () { onDiscard(); bar.remove(); });
      parent.insertBefore(bar, container);
      return bar;
    }

    /* ---- 제출 성공 감지 ---- */

    function ss() {
      try { return window.sessionStorage || null; } catch (e) { return null; }
    }

    function markSubmit(key) {
      var s = ss();
      if (!s || !key) return;
      try { s.setItem(SUBMIT_KEY, JSON.stringify({ key: key, at: Date.now() })); } catch (e) {}
    }

    /** 편집기 스캔마다: 저장 버튼을 누른 뒤 글 상세로 옮겨 왔으면 그 임시본을 지운다. */
    function checkSubmitted() {
      var s = ss();
      if (!s) return;
      var o = null;
      try { o = JSON.parse(s.getItem(SUBMIT_KEY) || 'null'); } catch (e) { o = null; }
      if (!o || !o.key) return;
      var age = Date.now() - (o.at || 0);
      var kind = core.routeKind();
      if (kind === 'detail' && age <= SUBMIT_WINDOW_MS) {
        removeDraft(o.key);
        try { s.removeItem(SUBMIT_KEY); } catch (e) {}
        return;
      }
      if (age > SUBMIT_WINDOW_MS || (kind !== 'write' && kind !== 'detail')) {
        try { s.removeItem(SUBMIT_KEY); } catch (e) {}
      }
    }

    /** 폼의 저장 버튼(#form 의 마지막 버튼 — 51-upload-guards 와 같은 판정, 또는 data-testid) */
    function isSaveButton(btn, form) {
      if (!btn || !form || form === document) return false;
      if (btn.getAttribute('data-testid') === 'form-save') return true;
      var all = form.querySelectorAll('button');
      return all.length > 0 && all[all.length - 1] === btn;
    }

    /* ---- 에디터에 붙이기 ---- */

    function attach(container) {
      var c = core.writeConfig && core.writeConfig();
      if (!c || !c.draft || !c.user) return;
      if (core.routeKind() !== 'write') return;
      if (!container.closest('.ckeditor5-wrapper') && !container.matches('.ckeditor5-wrapper')) return;
      var editor = core.editorInstanceNear(container);
      if (!editor || !editor.model) return;
      if (attached) { if (attached.has(editor)) return; attached.add(editor); } else if (editor.__ck5spDraft) return;
      editor.__ck5spDraft = true;

      var key = draftKey(c.user, window.location.pathname, window.location.search);
      if (!key) return;
      var form = formOf(container);
      var initialHtml = '';
      try { initialHtml = editor.getData(); } catch (e) { initialHtml = ''; }
      var tIn = titleInput(form);
      var initialTitle = tIn ? tIn.value : '';
      var base = fingerprint(initialHtml);

      prune(c.user, MAX_DRAFTS);

      // 남은 임시본 안내
      if (isPrivate(form)) {
        removeDraft(key);
      } else {
        var d = readDraft(key);
        if (d && (d.html !== initialHtml || (d.title || '') !== initialTitle)) {
          var changed = !!(d.base && d.base !== base && key.slice(-4) !== ':new');
          showBar(container, d, changed, function () {
            try { editor.setData(String(d.html || '')); } catch (e) { core.warnOnce('draft restore', e); }
            var ti = titleInput(form);
            if (ti && typeof d.title === 'string') setReactInput(ti, d.title);
          }, function () {
            removeDraft(key);
          });
        }
      }

      var timer = null;
      var save = function () {
        timer = null;
        if (editor.state === 'destroyed' || core.routeKind() !== 'write') return;
        if (isPrivate(form)) { removeDraft(key); return; }
        if (pendingUpload(editor)) { schedule(); return; }
        var html = '';
        try { html = editor.getData(); } catch (e) { return; }
        var ti = titleInput(form);
        var title = ti ? ti.value : '';
        if ((html === initialHtml && title === initialTitle) || (html.replace(/<[^>]*>|&nbsp;|\s/g, '') === '' && title.trim() === '')) {
          removeDraft(key);
          return;
        }
        writeDraft(key, c.user, { v: 1, t: Date.now(), title: title, html: html, base: base });
      };
      var schedule = function () {
        if (timer !== null) window.clearTimeout(timer);
        timer = window.setTimeout(save, SAVE_DELAY_MS);
      };

      editor.model.document.on('change:data', schedule);
      form.addEventListener('input', function (evt) {
        if (evt.target && evt.target.name === 'title') schedule();
      });
      form.addEventListener('change', function (evt) {
        if (evt.target && evt.target.name === 'is_secret' && isPrivate(form)) {
          if (timer !== null) { window.clearTimeout(timer); timer = null; }
          removeDraft(key);
        }
      });
      form.addEventListener('click', function (evt) {
        var btn = evt.target && evt.target.closest ? evt.target.closest('button') : null;
        if (!isSaveButton(btn, form)) return;
        // 저장 직전 내용을 한 번 더 남기고(실패 대비), 성공해서 상세로 옮겨 가면 checkSubmitted 가 지운다
        if (timer !== null) { window.clearTimeout(timer); save(); }
        markSubmit(key);
      }, true);
    }

    core.section({
      name: 'write-draft',
      scope: 'editor',
      editorOrder: 40,
      load: 'chunk',
      editor: function (container) { attach(container); },
      editorEnd: checkSubmitted
    });
  })(core);

  });
})();
