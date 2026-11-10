  /* ================================================================ *
   *  통합 스캔
   * ================================================================ */

  // 방문자 처리는 등록된 섹션을 order 순으로 부른다(06-registry). 섹션 순서: 마크다운 10 → 코드 복사 20
  // → 동영상 30 → SNS 40 → 링크 카드 50.
  function scan(root) {
    root = root || document;
    var cfg = readSettings();
    pruneVisibleWaits();
    try { ensureChunks(cfg, 'visitor'); } catch (e) { warnOnce('chunks (visitor)', e); }
    if (!visitorGateOpen(cfg)) { runGateClosedVisitors(root, cfg); return; }

    var contents;
    try { contents = root.querySelectorAll('.ck-content'); } catch (e) { return; }
    if (!contents.length && root !== document) return;
    if (!contents.length) contents = document.querySelectorAll('.ck-content');
    if (!contents.length) return;

    var ctx = newVisitorContext();

    for (var c = 0; c < contents.length; c++) {
      var scope = contents[c];
      if (isEditingArea(scope)) continue; // 편집 영역은 방문자 변환 대상이 아니다
      runVisitors(scope, cfg, ctx);
    }

    runVisitorEnds(ctx, cfg);
  }

  /* ================================================================ *
   *  공용 화면 진입 관찰자 (1.7.0)
   * ================================================================ *
   *  IntersectionObserver 하나를 모든 기능이 같이 쓴다(섹션은 자기 관찰자를 만들지 않는다).
   *  `core.whenVisible(el, fn)`: el 이 화면(위아래 400px 여유 포함)에 들어오면 fn(el) 을 한 번 부른다.
   *  관찰자가 없는 브라우저는 바로 부른다. 화면에서 떨어져 나간 대상은 방문자 스캔마다 관찰을 푼다.
   */
  var visObserver = null;
  var visWaits = []; // { el, fns }

  function runVisibleFns(w) {
    for (var i = 0; i < w.fns.length; i++) {
      try { w.fns[i](w.el); } catch (e) { warnOnce('whenVisible', e); }
    }
  }

  function onIntersect(entries) {
    for (var i = 0; i < entries.length; i++) {
      if (!entries[i].isIntersecting && !(entries[i].intersectionRatio > 0)) continue;
      var el = entries[i].target;
      for (var j = 0; j < visWaits.length; j++) {
        if (visWaits[j].el !== el) continue;
        var w = visWaits.splice(j, 1)[0];
        if (visObserver) visObserver.unobserve(el);
        runVisibleFns(w);
        break;
      }
    }
  }

  function whenVisible(el, fn) {
    if (!el || typeof fn !== 'function') return;
    if (typeof IntersectionObserver === 'undefined') { runVisibleFns({ el: el, fns: [fn] }); return; }
    for (var i = 0; i < visWaits.length; i++) {
      if (visWaits[i].el === el) { visWaits[i].fns.push(fn); return; }
    }
    if (!visObserver) visObserver = new IntersectionObserver(onIntersect, { rootMargin: '400px 0px' });
    visWaits.push({ el: el, fns: [fn] });
    visObserver.observe(el);
  }

  /** 문서에서 떨어져 나간 대기 대상을 정리한다(React 가 본문을 다시 넣은 경우 등). */
  function pruneVisibleWaits() {
    if (!visWaits.length) return;
    visWaits = visWaits.filter(function (w) {
      if (w.el.isConnected !== false) return true;
      if (visObserver) visObserver.unobserve(w.el);
      return false;
    });
  }

  core.whenVisible = whenVisible;

  /* ================================================================ *
   *  관찰자 · 부팅
   * ================================================================ */

  // 스케줄러: 감시기 하나가 방문자·편집기 스캔 요청을 낸다. 두 요청의 타이머는 따로 둔다
  // (방문자 200ms 트레일링, 편집기 250ms 고정 창). 해제는 하지 않는다(페이지 수명).
  var observer = null;
  var rescanTimer = null;
  var editorScanTimer = null;

  /** 추가된 요소 중 .ck-content 이거나 그 안이거나 그것을 품은 것이 있으면 true(방문자 스캔 조건) */
  function hasContentAddition(records) {
    return records.some(function (r) {
      return Array.prototype.some.call(r.addedNodes, function (n) {
        return n.nodeType === 1
          && ((n.matches && (n.matches('.ck-content') || n.matches('.ck-content *')))
            || (n.querySelector && n.querySelector('.ck-content')));
      });
    });
  }

  /** 방문자 스캔 요청 */
  function requestVisitorScan() {
    // 트레일링 디바운스 — 대기 중이어도 타이머를 새로 잡는다. (기존엔 rescanTimer!==null 이면
    // 이벤트를 버려서, 콘텐츠가 두 번에 나눠 들어오면 뒤엣것을 놓쳤다.) scan() 은 멱등이라
    // 자기 변경으로 옵저버가 한 번 더 울려도 no-op 스캔 1회 후 멎는다.
    if (rescanTimer !== null) window.clearTimeout(rescanTimer);
    rescanTimer = window.setTimeout(function () {
      rescanTimer = null;
      scan(document);
    }, 200);
  }

  /** 편집기 스캔 요청: 첫 요청 기준 고정 창(대기 중이면 버린다) */
  function requestEditorScan() {
    if (editorScanTimer !== null) return;
    editorScanTimer = window.setTimeout(function () { editorScanTimer = null; scanEditors(); }, 250);
  }

  /** 방문자 스캔 뒤 편집기 스캔, 같은 자리에서 동기로 */
  function kick() {
    scan(document);
    scanEditors();
  }

  function ensureObserver() {
    if (observer || typeof MutationObserver === 'undefined') return;
    observer = new MutationObserver(function (records) {
      // 같은 변경 묶음에서 방문자 요청(조건부)이 먼저, 편집기 요청(무조건)이 그다음.
      // 방문자 판정이 실패해도 편집기 요청은 막지 않는다.
      var hit = false;
      try { hit = hasContentAddition(records); } catch (e) { warnOnce('scan observer', e); }
      if (hit) requestVisitorScan();
      requestEditorScan();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function run() {
    runBoots(readSettings());
    ensureObserver();
    if (window.requestAnimationFrame) {
      requestAnimationFrame(function () { requestAnimationFrame(kick); });
    } else {
      kick();
    }
    window.setTimeout(kick, 400);
    window.setTimeout(kick, 900);
  }

