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
  core.authToken = authToken;
  core.chunkUrl = chunkUrl;
  core.isPostEditorEl = isPostEditorEl;
  core.postEditorCss = postEditorCss;

  /** 글 보기 기능 중 하나라도 켜져 있으면 true */
  function viewWanted(cfg) {
    return !!(cfg.viewToc || cfg.viewLightbox || cfg.viewFold || cfg.viewReadTime);
  }

  declareChunk({
    name: 'view',
    phase: 'visitor',
    want: viewWanted,
    where: function () { return !!findMainBody(); }
  });

  /* ---------------------------------------------------------------- *
   *  글쓰기 도우미 설정 (1.7.0)
   * ---------------------------------------------------------------- *
   *  임시 저장·글자 수 켜짐 여부는 방문자 설정(SPA 셸)에 없다. 사용자 글쓰기·수정 화면에서 로그인 토큰이
   *  있을 때만 `GET /api/plugins/<id>/write-config` 로 묻는다(로그인 사용자 전용).
   *  - 결과는 이 탭(sessionStorage)에 10분 보관한다. 토큰이 바뀌면(다른 계정) 버린다.
   *    보관 값: 켜짐 여부 2개, 사용자 구분 해시, 시각, 토큰 지문(되돌릴 수 없는 32비트 해시).
   *  - 실패·비로그인이면 꺼짐으로 보고 같은 화면에서 다시 묻지 않는다(1분).
   *  - 글자 수(WordCount)는 에디터를 만들 때만 넣을 수 있어, 글쓰기 화면의 본문 에디터 생성은 이 조회를
   *    최대 WRITE_CFG_WAIT_MS 까지 기다린다(core.editorConfigWait). 보관 값이 있으면 기다리지 않는다.
   */
  var WRITE_CFG_KEY = 'g7sp:write-config:v1';
  var WRITE_CFG_MAX_AGE = 10 * 60 * 1000;
  var WRITE_CFG_RETRY_MS = 60 * 1000;
  var WRITE_CFG_WAIT_MS = 1500;
  var writeCfg = null; // { draft, count, user, t, tk }
  var writeCfgPromise = null;
  var writeCfgFailedAt = 0;

  /** 토큰 지문(djb2 32비트) — 계정이 바뀌었는지 보는 데만 쓴다 */
  function tokenPrint(token) {
    var h = 5381;
    for (var i = 0; i < token.length; i++) h = ((h << 5) + h + token.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  function writeCfgFresh(c, tk) {
    return !!c && c.tk === tk && (Date.now() - (c.t || 0)) < WRITE_CFG_MAX_AGE;
  }

  /** 지금 알고 있는 글쓰기 도우미 설정(없으면 null). 보관 값도 본다. */
  function knownWriteConfig() {
    var token = authToken();
    if (!token) return null;
    var tk = tokenPrint(token);
    if (writeCfgFresh(writeCfg, tk)) return writeCfg;
    try {
      var raw = window.sessionStorage && window.sessionStorage.getItem(WRITE_CFG_KEY);
      var c = raw ? JSON.parse(raw) : null;
      if (writeCfgFresh(c, tk)) { writeCfg = c; return c; }
    } catch (e) {}
    return null;
  }

  /** 글쓰기 도우미 설정을 묻는다(이미 알면 그 값). 비로그인·실패면 null. */
  function loadWriteConfig() {
    var known = knownWriteConfig();
    if (known) return Promise.resolve(known);
    var token = authToken();
    if (!token || typeof fetch !== 'function') return Promise.resolve(null);
    if (writeCfgPromise) return writeCfgPromise;
    if (writeCfgFailedAt && Date.now() - writeCfgFailedAt < WRITE_CFG_RETRY_MS) return Promise.resolve(null);
    var tk = tokenPrint(token);
    writeCfgPromise = fetch('/api/plugins/' + IDENTIFIER + '/write-config', {
      headers: { Accept: 'application/json', Authorization: 'Bearer ' + token },
      credentials: 'same-origin'
    }).then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (j) {
      writeCfgPromise = null;
      if (!j || typeof j !== 'object') { writeCfgFailedAt = Date.now(); return null; }
      writeCfg = { draft: j.draft === true, count: j.count === true, user: String(j.user || ''), t: Date.now(), tk: tk };
      try { window.sessionStorage && window.sessionStorage.setItem(WRITE_CFG_KEY, JSON.stringify(writeCfg)); } catch (e) {}
      return writeCfg;
    }, function () {
      writeCfgPromise = null;
      writeCfgFailedAt = Date.now();
      return null;
    });
    return writeCfgPromise;
  }

  /** 본문 에디터 요소(댓글 에디터 제외)이고 사용자 글쓰기·수정 화면이면 true */
  function isUserWritePostEditor(el) {
    return routeKind() === 'write' && isPostEditorEl(el);
  }

  // 에디터 생성 전: 설정을 아직 모르면 조회를 잠깐 기다린다(상한 WRITE_CFG_WAIT_MS)
  core.editorConfigWait(function (el) {
    if (!isUserWritePostEditor(el) || !authToken() || knownWriteConfig()) return null;
    return new Promise(function (resolve) {
      var done = false;
      var finish = function () { if (!done) { done = true; resolve(); } };
      window.setTimeout(finish, WRITE_CFG_WAIT_MS);
      loadWriteConfig().then(finish, finish);
    });
  });

  // 에디터 생성 때: 글자 수가 켜져 있으면 빌드 내장 WordCount 를 본문 에디터에만 더한다(화면 표시는 write 묶음)
  core.editorConfig(function (el, cfg) {
    if (!isUserWritePostEditor(el)) return cfg;
    var wc = knownWriteConfig();
    var CK = window.CKEDITOR;
    if (!wc || !wc.count || !CK || !CK.WordCount || !cfg) return cfg;
    var plugins = Array.isArray(cfg.plugins) ? cfg.plugins : [];
    var extra = Array.isArray(cfg.extraPlugins) ? cfg.extraPlugins : [];
    if (plugins.indexOf(CK.WordCount) !== -1 || extra.indexOf(CK.WordCount) !== -1) return cfg;
    return Object.assign({}, cfg, { extraPlugins: extra.concat([CK.WordCount]) });
  });

  core.writeConfig = knownWriteConfig;

  declareChunk({
    name: 'write',
    phase: 'editor',
    want: function () {
      if (routeKind() !== 'write' || !authToken()) return false;
      var c = knownWriteConfig();
      if (!c) {
        loadWriteConfig().then(function (r) { if (r && (r.draft || r.count)) requestEditorScan(); });
        return false;
      }
      return c.draft || c.count;
    },
    where: function () {
      var eds = document.querySelectorAll('.ck-editor__editable');
      for (var i = 0; i < eds.length; i++) if (isPostEditorEl(eds[i])) return true;
      return false;
    }
  });

