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
      var shell = container.querySelector('.ck-editor') || container;
      if (shell.parentNode && shell.parentNode.querySelector(':scope > [data-ck5sp-write="count"]')) return;
      injectStyle();
      var line = document.createElement('div');
      line.className = 'ck5sp-count';
      line.setAttribute('data-ck5sp-write', 'count');
      line.setAttribute('aria-live', 'polite');
      shell.parentNode.insertBefore(line, shell.nextSibling);
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

  });
})();
