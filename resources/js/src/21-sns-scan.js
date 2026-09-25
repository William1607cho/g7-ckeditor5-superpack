  /* ================================================================ *
   *  SNS 임베드 — 방문자 패스 · 섹션 등록
   * ================================================================ */

  var reprocessTimers = []; // 임베드 재처리 타이머 id(scan 끝에서 갱신)

  /** 방문자 패스: 레거시 <oembed> 와 본문 단독 SNS 링크를 임베드로 바꾼다. */
  function snsEmbedVisitor(scope, cfg, ctx) {
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
      ctx.once('embed', function () { injectEmbedStyle(cfg); });
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
      ctx.once('embed', function () { injectEmbedStyle(cfg); });
      transformEmbed(block, raw, platform, cfg);
    }
  }

  /** 방문자 스캔 끝: 이번 스캔에서 임베드를 만들었으면 재처리 타이머를 다시 잡는다. */
  function snsEmbedVisitorEnd(ctx) {
    if (!ctx.has('embed')) return;
    // 마지막 스캔 기준 2·5·10초 한 벌만 둔다(스캔마다 겹쳐 쌓이지 않게)
    reprocessTimers.forEach(function (id) { window.clearTimeout(id); });
    reprocessTimers = [2000, 5000, 10000].map(function (ms) { return window.setTimeout(reprocessPresent, ms); });
  }

  // SNS 패스 자체는 snsEnabled 로 막지 않는다(플랫폼별 판단은 transformEmbed 안). snsEnabled 는 게이트에만 쓴다.
  core.section({
    name: 'sns-embed',
    scope: 'visitor',
    order: 40,
    load: 'eager',
    gate: function (cfg) { return cfg.snsEnabled; },
    styles: [EMBED_STYLE_ID],
    visitor: snsEmbedVisitor,
    visitorEnd: snsEmbedVisitorEnd
  });

