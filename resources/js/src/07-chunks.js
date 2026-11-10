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

