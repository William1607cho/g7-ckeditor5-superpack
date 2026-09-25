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
   *    마크다운 변환 코드(`code[data-ck5-mdc]`, `pre.ck5-md-pre`)는 자기 규칙이 있어 제외한다.
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

  function wrapClassicEditor(C) {
    if (!C || C.__ck5spCodeWrapped || typeof C.create !== 'function') return;
    var original = C.create;
    try {
      C.create = function (el, cfg) {
        var next = cfg;
        try { next = codeFormatConfig(el, cfg); } catch (e) { codeFormatWarn(e); next = cfg; }
        return original.call(this, el, next);
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
    var el = document.createElement('style');
    el.id = CODE_STYLE_ID;
    el.textContent = ''
      + sel(inline) + '{font-size:.9em;padding:.1em .35em;border-radius:4px;background:#f1f5f9;color:#1e293b;}'
      + sel(block) + '{font-size:.9em;line-height:1.5;white-space:pre;overflow-x:auto;padding:.8em 1em;border-radius:6px;border:1px solid #e2e8f0;background:#f8fafc;color:#1e293b;}'
      + sel(block + '>code') + '{font-size:inherit;background:transparent;padding:0;color:inherit;white-space:inherit;}'
      + sel(inline, 'html.dark ') + '{background:#334155;color:#e2e8f0;}'
      + sel(block, 'html.dark ') + '{background:#0f172a;color:#e2e8f0;border-color:#334155;}'
      // 가로 스크롤바를 항상 보이게(macOS 는 평소 숨김). 웹킷 규칙은 Chrome·Safari 용이다.
      // Chrome 121+ 는 표준 scrollbar-* 가 있으면 웹킷 규칙을 무시하므로, 표준 속성은 Firefox 에만 준다.
      + sel(block + '::-webkit-scrollbar') + '{height:8px;}'
      + sel(block + '::-webkit-scrollbar-track') + '{background:#e2e8f0;border-radius:4px;}'
      + sel(block + '::-webkit-scrollbar-thumb') + '{background:#64748b;border-radius:4px;}'
      + sel(block + '::-webkit-scrollbar-track', 'html.dark ') + '{background:#1e293b;}'
      + sel(block + '::-webkit-scrollbar-thumb', 'html.dark ') + '{background:#94a3b8;}'
      + '@supports (-moz-appearance:none){'
      + sel(block) + '{scrollbar-width:thin;scrollbar-color:#64748b #e2e8f0;}'
      + sel(block, 'html.dark ') + '{scrollbar-color:#94a3b8 #1e293b;}'
      + '}'
      // 언어가 plaintext 하나라 코드 블록 split button 의 언어 목록 화살표는 쓸모가 없다(본문 에디터만).
      + '.ckeditor5-wrapper .ck-code-block-dropdown .ck-splitbutton__arrow{display:none;}';
    (document.head || document.documentElement).appendChild(el);
  }

  installCodeFormatHook();
  try { injectCodeStyle(); } catch (e) { codeFormatWarn(e); }

