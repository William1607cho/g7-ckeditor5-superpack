  /* ================================================================ *
   *  코드 서식 — 본문 에디터에 인라인 코드·코드 블록 버튼 (1.5.0)
   * ================================================================ *
   *  - sirsoft-ckeditor5 를 고치지 않고, 설치된 CKEditor 빌드의 Code·CodeBlock 플러그인을
   *    **게시글 본문 에디터에만** 넣는다. sirsoft 는 `extraPlugins` 를 넘기지 않고, 플러그인은
   *    생성 뒤에 더할 수 없으므로 `ClassicEditor.create` 를 감싸 config 복사본에 더한다.
   *  - UMD 는 `window.CKEDITOR = {}` 를 먼저 대입하고 `exports.ClassicEditor = …` 를 나중에
   *    채운다. 그래서 `window.CKEDITOR` 대입과 그 객체의 `ClassicEditor` 대입을 접근자로 잡아
   *    감싼다(이미 로드돼 있으면 바로 감싼다). g7-comment-editor 는 같은 ClassicEditor 를
   *    쓰지만, 대상 요소가 `.ckeditor5-wrapper` 안이 아니므로 건드리지 않는다.
   *  - 어떤 예외도 에디터 생성을 막지 않는다: 원래 config 로 넘기고 console.warn 을 한 번만.
   *  - 저장된 코드의 표시 스타일은 설정과 무관하게 항상 넣는다(끄더라도 기존 글의 코드는 보여야 함).
   *    마크다운 변환 코드(`code[data-ck5-mdc]`, `pre.ck5-md-pre`)도 같은 규칙을 쓴다(1.6.0, 툴바 코드 모양).
   *    툴바 선택자는 그대로 두고 규칙마다 마크다운 선택자를 뒤에 더한다(툴바 쪽 우선순위를 바꾸지 않으려고).
   */

  var CODE_STYLE_ID = 'ck5sp-code-style';
  var codeFormatWarned = false;

  function codeFormatWarn(reason) {
    if (codeFormatWarned) return;
    codeFormatWarned = true;
    try { console.warn('[' + IDENTIFIER + '] code formatting disabled: ' + (reason && reason.message ? reason.message : reason)); } catch (e) {}
  }

  /** 툴바 항목 복사본에 name 을 after 바로 뒤(없으면 끝)에 넣는다. 이미 있으면 그대로. */
  function insertToolbarItem(items, name, after) {
    if (items.indexOf(name) !== -1) return;
    var i = items.indexOf(after);
    if (i === -1) items.push(name);
    else items.splice(i + 1, 0, name);
  }

  /** 본문 에디터면 Code·CodeBlock·툴바 항목을 더한 config 복사본을, 아니면 원래 cfg 를 돌려준다. */
  function codeFormatConfig(el, cfg) {
    if (!codeFormatEnabled()) return cfg;
    if (!el || !el.closest || !el.closest('.ckeditor5-wrapper')) return cfg;
    var CK = window.CKEDITOR;
    if (!CK || !CK.Code || !CK.CodeBlock) { codeFormatWarn('Code/CodeBlock not found in the CKEditor build'); return cfg; }
    if (!cfg || !Array.isArray(cfg.plugins) || !cfg.toolbar || !Array.isArray(cfg.toolbar.items)) { codeFormatWarn('unexpected editor config'); return cfg; }

    var extra = [];
    if (cfg.plugins.indexOf(CK.Code) === -1) extra.push(CK.Code);
    var addBlock = cfg.plugins.indexOf(CK.CodeBlock) === -1;
    if (addBlock) extra.push(CK.CodeBlock);

    var items = cfg.toolbar.items.slice();
    insertToolbarItem(items, 'code', 'strikethrough');
    insertToolbarItem(items, 'codeBlock', 'blockQuote');

    var next = Object.assign({}, cfg, {
      extraPlugins: (Array.isArray(cfg.extraPlugins) ? cfg.extraPlugins : []).concat(extra),
      toolbar: Object.assign({}, cfg.toolbar, { items: items })
    });
    // CKEditor 는 'Plain text' 라벨을 스스로 번역한다(ko: 평문). 이미 CodeBlock 이 있는 프리셋은 언어 설정도 그대로 둔다.
    if (addBlock && !cfg.codeBlock) next.codeBlock = { languages: [{ language: 'plaintext', label: 'Plain text' }] };
    return next;
  }

  /** 등록된 생성 설정 보강 함수(`core.editorConfig`)를 순서대로 적용한다. 하나가 예외를 내면 그것만 건너뛴다. */
  function applyEditorConfigHooks(el, cfg) {
    var next = cfg;
    for (var i = 0; i < editorConfigHooks.length; i++) {
      try {
        var r = editorConfigHooks[i](el, next);
        if (r) next = r;
      } catch (e) { warnOnce('editor config hook ' + i, e); }
    }
    return next;
  }

  /**
   * 생성 전에 기다릴 것(글쓰기 도우미 설정 조회 등, `editorConfigWait`)이 있으면 기다린 뒤(상한 있음)
   * 설정을 보강해 원래 create 를 부른다. 기다릴 것이 없으면 지금처럼 바로 부른다.
   */
  function wrapClassicEditor(C) {
    if (!C || C.__ck5spCodeWrapped || typeof C.create !== 'function') return;
    var original = C.create;
    try {
      C.create = function (el, cfg) {
        var self = this;
        var wait = null;
        try { wait = editorConfigWait(el); } catch (e) { warnOnce('editor config wait', e); wait = null; }
        if (!wait) return original.call(self, el, applyEditorConfigHooks(el, cfg));
        return wait.then(function () {
          return original.call(self, el, applyEditorConfigHooks(el, cfg));
        });
      };
      C.__ck5spCodeWrapped = true;
    } catch (e) { codeFormatWarn(e); }
  }

  /** UMD exports 객체: ClassicEditor 가 있으면 바로, 나중에 대입되면 그때 감싼다. */
  function watchCkeditorExports(ck) {
    if (!ck || typeof ck !== 'object') return;
    var current = ck.ClassicEditor;
    if (current) wrapClassicEditor(current);
    var d = Object.getOwnPropertyDescriptor(ck, 'ClassicEditor');
    if (d && d.configurable === false) return;
    Object.defineProperty(ck, 'ClassicEditor', {
      configurable: true,
      enumerable: true,
      get: function () { return current; },
      set: function (v) { current = v; wrapClassicEditor(v); }
    });
  }

  function installCodeFormatHook() {
    try {
      var current = window.CKEDITOR;
      if (current) watchCkeditorExports(current);
      var d = Object.getOwnPropertyDescriptor(window, 'CKEDITOR');
      if (d && d.configurable === false) return;
      Object.defineProperty(window, 'CKEDITOR', {
        configurable: true,
        enumerable: true,
        get: function () { return current; },
        set: function (v) {
          current = v;
          try { watchCkeditorExports(v); } catch (e) { codeFormatWarn(e); }
        }
      });
    } catch (e) { codeFormatWarn(e); }
  }

  /** 저장된 코드 표시 스타일(설정 무관, 1회). */
  function injectCodeStyle() {
    if (document.getElementById(CODE_STYLE_ID)) return;
    var scopes = ['.ck-content.prose', '.ckeditor5-wrapper .ck-editor__editable'];
    var sel = function (suffix, prefix) {
      return scopes.map(function (s) { return (prefix || '') + s + ' ' + suffix; }).join(',');
    };
    var inline = ':not(pre)>code:not([data-ck5-mdc])';
    var block = 'pre:not(.ck5-md-pre)';
    var mdInline = '.ck-content code[data-ck5-mdc]'; // 마크다운 인라인 코드(방문자 화면)
    var mdBlock = '.ck-content pre.ck5-md-pre'; // 마크다운 코드 블록(방문자 화면)
    var el = document.createElement('style');
    el.id = CODE_STYLE_ID;
    el.textContent = ''
      + sel(inline) + ',' + mdInline + '{font-size:.9em;padding:.1em .35em;border-radius:4px;background:#f1f5f9;color:#1e293b;}'
      + sel(block) + ',' + mdBlock + '{font-size:.9em;line-height:1.5;white-space:pre;overflow-x:auto;padding:.8em 1em;border-radius:6px;border:1px solid #e2e8f0;background:#f8fafc;color:#1e293b;}'
      + sel(block + '>code') + ',' + mdBlock + '>code' + '{font-size:inherit;background:transparent;padding:0;color:inherit;white-space:inherit;}'
      + sel(inline, 'html.dark ') + ',html.dark ' + mdInline + '{background:#334155;color:#e2e8f0;}'
      + sel(block, 'html.dark ') + ',html.dark ' + mdBlock + '{background:#0f172a;color:#e2e8f0;border-color:#334155;}'
      // 가로 스크롤바를 항상 보이게(macOS 는 평소 숨김). 웹킷 규칙은 Chrome·Safari 용이다.
      // Chrome 121+ 는 표준 scrollbar-* 가 있으면 웹킷 규칙을 무시하므로, 표준 속성은 Firefox 에만 준다.
      + sel(block + '::-webkit-scrollbar') + ',' + mdBlock + '::-webkit-scrollbar' + '{height:8px;}'
      + sel(block + '::-webkit-scrollbar-track') + ',' + mdBlock + '::-webkit-scrollbar-track' + '{background:#e2e8f0;border-radius:4px;}'
      + sel(block + '::-webkit-scrollbar-thumb') + ',' + mdBlock + '::-webkit-scrollbar-thumb' + '{background:#64748b;border-radius:4px;}'
      + sel(block + '::-webkit-scrollbar-track', 'html.dark ') + ',html.dark ' + mdBlock + '::-webkit-scrollbar-track' + '{background:#1e293b;}'
      + sel(block + '::-webkit-scrollbar-thumb', 'html.dark ') + ',html.dark ' + mdBlock + '::-webkit-scrollbar-thumb' + '{background:#94a3b8;}'
      + '@supports (-moz-appearance:none){'
      + sel(block) + ',' + mdBlock + '{scrollbar-width:thin;scrollbar-color:#64748b #e2e8f0;}'
      + sel(block, 'html.dark ') + ',html.dark ' + mdBlock + '{scrollbar-color:#94a3b8 #1e293b;}'
      + '}'
      // 언어가 plaintext 하나라 코드 블록 split button 의 언어 목록 화살표는 쓸모가 없다(본문 에디터만).
      + '.ckeditor5-wrapper .ck-code-block-dropdown .ck-splitbutton__arrow{display:none;}';
    (document.head || document.documentElement).appendChild(el);
  }

  // install 은 등록 즉시(= 번들 평가 중 이 자리) 실행된다. 대입 훅은 CKEditor UMD 보다 먼저 걸려야 한다.
  core.section({
    name: 'code-format',
    scope: 'editor',
    load: 'eager',
    styles: [CODE_STYLE_ID],
    install: function () {
      // 생성 설정 보강의 첫 항목 — 코드 서식(1.5.0 동작 그대로). 그 뒤에 다른 기능이 core.editorConfig 로 더한다.
      editorConfigHooks.unshift(function (el, cfg) {
        try { return codeFormatConfig(el, cfg); } catch (e) { codeFormatWarn(e); return cfg; }
      });
      installCodeFormatHook();
      try { injectCodeStyle(); } catch (e) { codeFormatWarn(e); }
    }
  });

