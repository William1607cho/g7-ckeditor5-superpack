  /* ================================================================ *
   *  통합 스캔
   * ================================================================ */

  var reprocessTimers = []; // 임베드 재처리 타이머 id(scan 끝에서 갱신)

  function scan(root) {
    root = root || document;
    var cfg = readSettings();
    if (!cfg.snsEnabled && !cfg.linkcardEnabled && !cfg.videoEnabled && !cfg.mdEnabled) { addCodeCopyButtons(root); return; }

    var contents;
    try { contents = root.querySelectorAll('.ck-content'); } catch (e) { return; }
    if (!contents.length && root !== document) return;
    if (!contents.length) contents = document.querySelectorAll('.ck-content');
    if (!contents.length) return;

    var didEmbed = false;
    var didCard = false;
    var didVideo = false;

    for (var c = 0; c < contents.length; c++) {
      var scope = contents[c];
      if (isEditingArea(scope)) continue; // 편집 영역은 방문자 변환 대상이 아니다

      /* ---- -1) 마크다운 문법 → 실제 서식 (다른 모든 패스보다 먼저) ---- */
      // 링크가 실제 <a> 가 된 다음에 SNS/OG 카드 승격이 걸리도록 순서상 맨 앞.
      if (cfg.mdEnabled) renderMarkdown(scope, cfg);
      addCodeCopyButtons(scope);

      /* ---- 0) 로컬 동영상 링크 → <video> 승격 ---- */
      // 링크 텍스트(파일명일 수도, URL일 수도)와 무관하게 href 패턴만으로 잡는다.
      if (cfg.videoEnabled) {
        var vAnchors = scope.querySelectorAll('a[href]');
        for (var vi = 0; vi < vAnchors.length; vi++) {
          var va = vAnchors[vi];
          if (!videoIdOf(va.getAttribute('href') || va.href)) continue;
          if (va.closest('.ck5-video')) continue;
          var vblk = va.closest('p, div, figure');
          if (vblk && vblk !== scope) vblk.dataset.ck5Lc = 'video';
          if (!didVideo) { injectVideoStyle(); didVideo = true; }
          promoteVideoAnchor(va);
        }
      }

      /* ---- 1) SNS 임베드 패스 ---- */
      // 1a. 레거시 <oembed url> (previewsInData:false 로 저장됐던 형태)
      var oembeds = scope.querySelectorAll('oembed[url]');
      for (var i = 0; i < oembeds.length; i++) {
        var oe = oembeds[i];
        var rawOe = (oe.getAttribute('url') || '').trim();
        var figure = oe.closest('figure.media');
        var tgt = figure || oe;
        if (tgt.parentElement && tgt.parentElement.classList.contains(EMBED_WRAPPER_CLASS)) continue;
        if (!rawOe) { if (figure) figure.remove(); else oe.remove(); continue; }
        var poe = detectPlatform(rawOe);
        if (poe === 'unknown' && !cfg.linkcardEnabled) continue; // 알수없음 + 카드 꺼짐 → 그대로
        if (!didEmbed) { injectEmbedStyle(cfg); didEmbed = true; }
        transformEmbed(tgt, rawOe, poe, cfg);
      }

      // 1b. 본문 단독 SNS 링크
      var blocks = scope.querySelectorAll('p, div');
      for (var b = 0; b < blocks.length; b++) {
        var block = blocks[b];
        if (block.dataset.ck5Lc) continue;
        if (block.closest('.ck5-linkcard, .' + EMBED_WRAPPER_CLASS)) continue;
        var link = soleLinkOf(block);
        if (!link) continue;
        var raw = link.href;
        var platform = detectPlatform(raw);
        if (platform === 'unknown') continue; // 링크 카드 패스에서 처리
        // SNS 로 인식된 URL 은 (임베드하든 안 하든) 링크 카드 대상에서 제외 → 처리표시
        block.dataset.ck5Lc = 'sns';
        if (!didEmbed) { injectEmbedStyle(cfg); didEmbed = true; }
        transformEmbed(block, raw, platform, cfg);
      }

      /* ---- 2) 링크 카드 패스 ---- */
      if (!cfg.linkcardEnabled) continue;

      var cardTargets = [];

      // 2a. 본문 단독 일반 링크 (SNS 아님)
      var lcBlocks = scope.querySelectorAll('p, div');
      for (var k = 0; k < lcBlocks.length; k++) {
        var lb = lcBlocks[k];
        if (lb.dataset.ck5Lc) continue;
        if (lb.closest('.ck5-linkcard, .' + EMBED_WRAPPER_CLASS)) continue;
        var la = soleLinkOf(lb);
        if (!la) continue;
        if (detectPlatform(la.href) !== 'unknown') continue; // SNS 는 임베드 패스 소관
        lb.dataset.ck5Lc = 'pending';
        cardTargets.push({ url: la.href, replace: lb, kind: 'link' });
      }

      // 2b. 임베드 패스가 만든 미지원 폴백 래퍼 (레거시 <oembed> unknown 등)
      var fbs = scope.querySelectorAll('.' + EMBED_WRAPPER_CLASS + '[data-ck5-embed-platform="unknown"]');
      for (var f = 0; f < fbs.length; f++) {
        var wrap = fbs[f];
        if (wrap.dataset.ck5Lc) continue;
        var fbLink = wrap.querySelector('a[href^="http"]');
        if (!fbLink) continue;
        wrap.dataset.ck5Lc = 'pending';
        cardTargets.push({ url: fbLink.href, replace: wrap, kind: 'fallback' });
      }

      if (cardTargets.length) {
        if (!didCard) { injectLinkCardStyle(cfg); didCard = true; }
        cardTargets.forEach(function (tt) {
          getPreview(tt.url).then(function (p) {
            if (!tt.replace.isConnected) return;
            applyCard(tt.replace, tt.url, p, tt.kind, cfg);
          });
        });
      }
    }

    if (didEmbed) {
      // 마지막 스캔 기준 2·5·10초 한 벌만 둔다(스캔마다 겹쳐 쌓이지 않게)
      reprocessTimers.forEach(function (id) { window.clearTimeout(id); });
      reprocessTimers = [2000, 5000, 10000].map(function (ms) { return window.setTimeout(reprocessPresent, ms); });
    }
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
    injectEditorStyleCss(readSettings());
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

