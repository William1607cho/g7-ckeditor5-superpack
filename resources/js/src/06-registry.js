  /* ================================================================ *
   *  섹션 등록부 · 방문자 패스
   * ================================================================ *
   *  기능 섹션은 번들 평가 때 자기 조각 끝에서 `core.section(spec)` 으로 등록한다.
   *  등록부는 이 IIFE 안에만 있고 window 에 올리지 않는다.
   *  - 방문자 패스는 `order` 오름차순(같은 값은 등록 순)으로 섹션을 부른다. 결합 순서에 기대지 않는다.
   *  - `gate(cfg)` 가 있는 섹션 중 하나라도 참이어야 `.ck-content` 를 돈다. 모두 거짓이면
   *    게이트 없는 섹션만 root 에 한 번 부른다(1.5.0 scan 의 조기 반환과 같다).
   *  - 편집기 패스는 `editorOrder` 오름차순으로 컨테이너마다 `editor(container)` 를, 스캔 끝에
   *    `editorEnd()` 를 부른다. `boot(cfg)` 는 부팅 run() 첫머리에서 한 번.
   *  - `install()` 은 등록 직후 그 자리에서 바로 부른다(= 번들 평가 중 그 조각의 위치).
   *  - 받기만 하고 아직 부르지 않는 항목: settings·guard.
   *  - `load` 는 'eager' 만 받는다(지연 로드는 자리만 둔다).
   */

  var sections = []; // 등록된 섹션 spec — 방문자 order 오름차순, order 없는 섹션은 뒤
  var editorSections = []; // 편집기 섹션 spec — editorOrder 오름차순, editorOrder 없는 섹션은 뒤
  var namespaces = {};

  var core = {
    id: IDENTIFIER,
    section: registerSection,
    ns: function (name) { return namespaces[name] || (namespaces[name] = {}); }
  };

  function isVisitorSection(spec) {
    return spec.scope === 'visitor' || spec.scope === 'both';
  }

  function visitorOrderOf(spec) {
    return isVisitorSection(spec) ? spec.order : Infinity;
  }

  function isEditorSection(spec) {
    return spec.scope === 'editor' || spec.scope === 'both';
  }

  function editorOrderOf(spec) {
    return spec.editor ? spec.editorOrder : Infinity;
  }

  function registerSection(spec) {
    if (!spec || typeof spec.name !== 'string' || !spec.name) { logger.warn('section: name is required'); return; }
    for (var i = 0; i < sections.length; i++) {
      if (sections[i].name === spec.name) { logger.warn('section: duplicate name ' + spec.name); return; }
    }
    if (spec.load !== undefined && spec.load !== 'eager') { logger.warn('section: only eager load is supported: ' + spec.name); return; }
    if (isVisitorSection(spec) && typeof spec.order !== 'number') { logger.warn('section: visitor order is required: ' + spec.name); return; }
    if (isEditorSection(spec) && spec.editor && typeof spec.editorOrder !== 'number') { logger.warn('section: editor order is required: ' + spec.name); return; }
    var at = sections.length;
    while (at > 0 && visitorOrderOf(sections[at - 1]) > visitorOrderOf(spec)) at--;
    sections.splice(at, 0, spec);
    if (isEditorSection(spec)) {
      var ea = editorSections.length;
      while (ea > 0 && editorOrderOf(editorSections[ea - 1]) > editorOrderOf(spec)) ea--;
      editorSections.splice(ea, 0, spec);
    }
    if (spec.install) spec.install();
  }

  /** 방문자 스캔 한 번 동안 섹션끼리 나누는 표시. once 는 1.5.0 의 `if (!didX) { …; didX = true; }` 와 같다. */
  function newVisitorContext() {
    var flags = {};
    return {
      once: function (key, fn) {
        if (flags[key]) return;
        fn();
        flags[key] = true;
      },
      has: function (key) { return !!flags[key]; }
    };
  }

  /** 게이트가 있는 방문자 섹션 중 하나라도 켜져 있으면 true */
  function visitorGateOpen(cfg) {
    for (var i = 0; i < sections.length; i++) {
      var s = sections[i];
      if (isVisitorSection(s) && typeof s.gate === 'function' && s.gate(cfg)) return true;
    }
    return false;
  }

  /** 게이트가 닫혔을 때: 게이트 없는 방문자 섹션만 root 에 한 번씩 */
  function runGateClosedVisitors(root, cfg) {
    for (var i = 0; i < sections.length; i++) {
      var s = sections[i];
      if (isVisitorSection(s) && typeof s.gate !== 'function' && s.visitor) s.visitor(root, cfg, null);
    }
  }

  /** `.ck-content` 하나(편집 영역 제외)에 켜진 방문자 섹션을 order 순으로 */
  function runVisitors(scope, cfg, ctx) {
    for (var i = 0; i < sections.length; i++) {
      var s = sections[i];
      if (!isVisitorSection(s) || !s.visitor) continue;
      if (s.enabled && !s.enabled(cfg)) continue;
      try { s.visitor(scope, cfg, ctx); } catch (e) { warnOnce('section ' + s.name + ' (visitor)', e); }
    }
  }

  /** 방문자 스캔 한 번이 끝난 뒤 */
  function runVisitorEnds(ctx, cfg) {
    for (var i = 0; i < sections.length; i++) {
      var s = sections[i];
      if (isVisitorSection(s) && s.visitorEnd) s.visitorEnd(ctx, cfg);
    }
  }

  /** 부팅(run() 첫머리) 때 한 번 */
  function runBoots(cfg) {
    for (var i = 0; i < sections.length; i++) {
      if (sections[i].boot) sections[i].boot(cfg);
    }
  }

  /** 편집기 컨테이너 하나(편집기 인스턴스 확인 뒤)에 편집기 섹션을 editorOrder 순으로 */
  function runEditors(container) {
    for (var i = 0; i < editorSections.length; i++) {
      if (editorSections[i].editor) { try { editorSections[i].editor(container); } catch (e) { warnOnce('section ' + editorSections[i].name + ' (editor)', e); } }
    }
  }

  /** 편집기 스캔 한 번이 끝난 뒤(컨테이너 목록과 무관) */
  function runEditorEnds() {
    for (var i = 0; i < editorSections.length; i++) {
      if (editorSections[i].editorEnd) editorSections[i].editorEnd();
    }
  }

