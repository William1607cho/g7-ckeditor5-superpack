  /* ================================================================ *
   *  지연 로드 묶음 (1.7.0)
   * ================================================================ *
   *  글 보기(B)·글쓰기 도우미(C) 코드는 전역 번들에 넣지 않고 별도 파일(`dist/js/<묶음>.js`)로 둔다.
   *  기능이 켜져 있고 그 화면일 때만 `<script>` 하나를 넣어 불러온다(꺼져 있으면 요청 0).
   *  - 묶음 파일은 `window.__G7Ckeditor5Superpack.chunk(이름, function (core) { … })` 를 부르고,
   *    그 안에서 `core.section({ load: 'chunk', … })` 로 섹션을 등록한다. 등록 뒤 두 스캔을 다시 돈다.
   *  - 주소는 코어 공개 에셋 경로(`/api/plugins/assets/<id>/<경로>`, 확장자 없는 모드면 `?file=`)에
   *    `cache_version` 을 붙인다. 확장을 갱신하면 코어가 이 값을 바꾼다.
   *  - 묶음 선언(`declareChunk`)은 `want(cfg)`(설정)·`where(cfg)`(화면)·`phase`(visitor|editor)를 갖는다.
   */

  var chunks = {}; // 이름 -> { spec, state: idle|loading|ready|error }

  function declareChunk(spec) {
    chunks[spec.name] = { spec: spec, state: 'idle' };
  }

  /** 묶음 파일 주소 */
  function chunkUrl(name) {
    var c = window.G7Config || {};
    var path = 'dist/js/' + name + '.js';
    var v = c.cache_version;
    var mode = c.assetUrlMode || window.__g7AssetUrlMode || 'extension';
    var base = '/api/plugins/assets/' + IDENTIFIER;
    if (mode === 'extensionless') {
      return base + '?file=' + encodeURIComponent(path) + (v != null ? '&v=' + encodeURIComponent(v) : '');
    }
    return base + '/' + path + (v != null ? '?v=' + encodeURIComponent(v) : '');
  }

  /** 이 단계(visitor|editor)의 묶음 중 필요한 것을 불러온다. 스캔 첫머리에서 부른다. */
  function ensureChunks(cfg, phase) {
    for (var name in chunks) {
      if (!Object.prototype.hasOwnProperty.call(chunks, name)) continue;
      var c = chunks[name];
      if (c.state !== 'idle' || c.spec.phase !== phase) continue;
      var ok = false;
      try { ok = !!(c.spec.want(cfg) && c.spec.where(cfg)); } catch (e) { warnOnce('chunk ' + name + ' (check)', e); }
      if (ok) loadChunk(name);
    }
  }

  function loadChunk(name) {
    var c = chunks[name];
    c.state = 'loading';
    try {
      var s = document.createElement('script');
      s.async = true;
      s.src = chunkUrl(name);
      s.setAttribute('data-ck5sp-chunk', name);
      s.onerror = function () { c.state = 'error'; warnOnce('chunk ' + name, 'load failed'); };
      (document.head || document.body).appendChild(s);
    } catch (e) {
      c.state = 'error';
      warnOnce('chunk ' + name, e);
    }
  }

  /** 묶음 파일이 부른다. 선언되지 않았거나 이미 받은 묶음은 무시한다. */
  function acceptChunk(name, factory) {
    var c = chunks[name];
    if (!c || c.state === 'ready' || typeof factory !== 'function') return;
    c.state = 'ready';
    try { factory(core); } catch (e) { warnOnce('chunk ' + name, e); }
    window.setTimeout(kick, 0);
  }

  /* ---- 켜짐 판정 ---- */

  /** 로그인 사용자 uuid(코어 전역 상태 `_global.currentUser.uuid`), 없으면 '' */
  function currentUserUuid() {
    try {
      var st = (window.G7Core && window.G7Core.state && window.G7Core.state.get && window.G7Core.state.get()) || {};
      var u = (st._global && st._global.currentUser) || st.currentUser;
      return u && u.uuid ? String(u.uuid) : '';
    } catch (e) { return ''; }
  }

  /** 글 보기 기능 중 하나라도 켜져 있으면 true */
  function viewWanted(cfg) {
    return !!(cfg.viewToc || cfg.viewLightbox || cfg.viewFold || cfg.viewReadTime);
  }

  /** 글쓰기 도우미 묶음이 필요한가: 로그인 사용자 + 사용자 글쓰기·수정 화면 + 기능 하나라도 켜짐 */
  function writeWanted(cfg) {
    return !!((cfg.writeDraft || cfg.writeCount) && routeKind() === 'write' && currentUserUuid());
  }

  declareChunk({
    name: 'view',
    phase: 'visitor',
    want: viewWanted,
    where: function () { return !!findMainBody(); }
  });

  declareChunk({
    name: 'write',
    phase: 'editor',
    want: writeWanted,
    where: function () { return postEditorContainers(document).length > 0; }
  });

  // 글자 수(1.7.0): 켜져 있으면 빌드 내장 WordCount 를 사용자 글쓰기 화면의 본문 에디터에만 더한다.
  // 플러그인은 에디터 생성 때만 넣을 수 있어 전역에 둔다(화면 표시는 write 묶음, 로그인 사용자만).
  // 새로 고침 직후에는 에디터가 로그인 상태보다 먼저 만들어질 수 있어, 여기서는 로그인을 따지지 않는다.
  core.editorConfig(function (el, cfg) {
    var CK = window.CKEDITOR;
    if (!cfg || !CK || !CK.WordCount || !isPostEditorEl(el)) return cfg;
    if (!readSettings().writeCount || routeKind() !== 'write') return cfg;
    var plugins = Array.isArray(cfg.plugins) ? cfg.plugins : [];
    var extra = Array.isArray(cfg.extraPlugins) ? cfg.extraPlugins : [];
    if (plugins.indexOf(CK.WordCount) !== -1 || extra.indexOf(CK.WordCount) !== -1) return cfg;
    return Object.assign({}, cfg, { extraPlugins: extra.concat([CK.WordCount]) });
  });

  // 묶음이 쓰는 코어 도우미(묶음은 IIFE 밖에서 평가되므로 core 로만 받는다)
  core.t = function (key, fallback) { return t(key, fallback); };
  core.esc = esc;
  core.warnOnce = warnOnce;
  core.logger = logger;
  core.readSettings = readSettings;
  core.isEditingArea = isEditingArea;
  core.editorInstanceNear = editorInstanceNear;
  core.findMainBody = findMainBody;
  core.routeKind = routeKind;
  core.chunkUrl = chunkUrl;
  core.isPostEditorEl = isPostEditorEl;
  core.postEditorCss = postEditorCss;
  core.currentUserUuid = currentUserUuid;
  core.writeWanted = writeWanted;

