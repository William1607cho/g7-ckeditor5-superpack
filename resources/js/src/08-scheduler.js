  /* ================================================================ *
   *  통합 스캔
   * ================================================================ */

  // 방문자 처리는 등록된 섹션을 order 순으로 부른다(06-registry). 섹션 순서: 마크다운 10 → 코드 복사 20
  // → 동영상 30 → SNS 40 → 링크 카드 50.
  function scan(root) {
    root = root || document;
    var cfg = readSettings();
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
   *  관찰자 · 부팅
   * ================================================================ */

  var observer = null;
  var rescanTimer = null;

  function ensureObserver() {
    if (observer || typeof MutationObserver === 'undefined') return;
    observer = new MutationObserver(function (records) {
      var hit = records.some(function (r) {
        return Array.prototype.some.call(r.addedNodes, function (n) {
          return n.nodeType === 1
            && ((n.matches && (n.matches('.ck-content') || n.matches('.ck-content *')))
              || (n.querySelector && n.querySelector('.ck-content')));
        });
      });
      if (!hit) return;
      // 트레일링 디바운스 — 대기 중이어도 타이머를 새로 잡는다. (기존엔 rescanTimer!==null 이면
      // 이벤트를 버려서, 콘텐츠가 두 번에 나눠 들어오면 뒤엣것을 놓쳤다.) scan() 은 멱등이라
      // 자기 변경으로 옵저버가 한 번 더 울려도 no-op 스캔 1회 후 멎는다.
      if (rescanTimer !== null) window.clearTimeout(rescanTimer);
      rescanTimer = window.setTimeout(function () {
        rescanTimer = null;
        scan(document);
      }, 200);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  var editorObserver = null;
  var editorScanTimer = null;
  function ensureEditorObserver() {
    if (editorObserver || typeof MutationObserver === 'undefined') return;
    editorObserver = new MutationObserver(function () {
      if (editorScanTimer !== null) return;
      editorScanTimer = window.setTimeout(function () { editorScanTimer = null; scanEditors(); }, 250);
    });
    editorObserver.observe(document.body, { childList: true, subtree: true });
  }

  function run() {
    runBoots(readSettings());
    ensureObserver();
    ensureEditorObserver();
    if (window.requestAnimationFrame) {
      requestAnimationFrame(function () { requestAnimationFrame(function () { scan(document); scanEditors(); }); });
    } else {
      scan(document);
      scanEditors();
    }
    window.setTimeout(function () { scan(document); scanEditors(); }, 400);
    window.setTimeout(function () { scan(document); scanEditors(); }, 900);
  }

