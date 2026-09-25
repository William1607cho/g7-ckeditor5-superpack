  /* ================================================================ *
   *  로컬 동영상 — 렌더 승격 (방문자 화면)
   * ================================================================ */

  var VIDEO_STYLE_ID = 'ck5-video-style';

  /** URL(상대/절대 무관) 이 이 슈퍼팩의 동영상 서빙 엔드포인트면 public_id, 아니면 null */
  function videoIdOf(url) {
    var m = String(url || '').match(VIDEO_URL_RE);
    return m ? m[1].toLowerCase() : null;
  }

  function injectVideoStyle() {
    if (document.getElementById(VIDEO_STYLE_ID)) return;
    var el = document.createElement('style');
    el.id = VIDEO_STYLE_ID;
    el.textContent = ''
      + '.ck5-video{margin:1.1em 0;text-align:center;}'
      + '.ck5-video>video{max-width:100%;width:640px;max-height:70vh;border-radius:10px;background:#000;display:block;margin:0 auto;}'
      + '.ck5-video[data-size="sm"]>video{width:360px;}'
      + '.ck5-video[data-size="lg"]>video{width:960px;}'
      + '.ck5-video__foot{margin-top:.55em;text-align:center;line-height:1;}'
      + '.ck5-video__btn{display:inline-block;padding:6px 16px;border-radius:9999px;font-size:.8125rem;font-weight:600;text-decoration:none;background:#111827;color:#fff;transition:background .15s;}'
      + '.ck5-video__btn:hover{background:#000;}'
      + 'html.dark .ck5-video__btn{background:#1f2937;}'
      + 'html.dark .ck5-video__btn:hover{background:#374151;}';
    document.head.appendChild(el);
  }

  /**
   * 동영상 링크(<a>) 하나를 <video> 플레이어로 승격한다. 링크 텍스트가 파일명이든 URL이든
   * 무관하다(에디터가 파일명 텍스트로 삽입하므로). 교체 대상은 링크를 감싼 블록
   * (<figure>/<p>/<div>) — 그 블록 안에 링크 말고 다른 의미 있는 내용이 있으면 링크만 교체.
   */
  function promoteVideoAnchor(a) {
    var url = a.getAttribute('href') || a.href || '';
    var id = videoIdOf(url);
    if (!id) return;
    // 이미 처리됨?
    if (a.closest('.ck5-video')) return;
    if (a.dataset && a.dataset.ck5Video === 'done') return;

    var mime = (a.getAttribute('data-ck5-video-mime') || '').trim();
    var srcAttr = (a.getAttribute('data-ck5-video-src') || url).trim();
    var sizeM = url.match(/[?&]size=(sm|lg)\b/i);
    var size = sizeM ? sizeM[1].toLowerCase() : 'md';

    var wrap = document.createElement('div');
    wrap.className = 'ck5-video';
    wrap.setAttribute('data-ck5-video', id);
    if (size !== 'md') wrap.setAttribute('data-size', size);
    // <source type> 힌트가 있으면 붙이고, 없으면 서버 Content-Type 에 맡긴다.
    var videoInner = mime
      ? '<source src="' + esc(srcAttr) + '" type="' + esc(mime) + '">'
      : '';
    wrap.innerHTML =
      '<video controls preload="metadata" playsinline' + (mime ? '' : ' src="' + esc(srcAttr) + '"') + '>'
      + videoInner
      + '</video>'
      + '<div class="ck5-video__foot">'
      + '<a class="ck5-video__btn" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">'
      + esc(t('content.video.open', '동영상 원본 열기'))
      + '</a></div>';

    // 승격 대상: figure.ck5sp-video-embed > (전체 교체) / 그 외엔 링크만 감싼 블록
    var block = a.closest('figure.ck5sp-video-embed, figure.ck5sp-video, p, div');
    if (block && block.classList
        && (block.classList.contains('ck5sp-video-embed') || block.classList.contains('ck5sp-video'))) {
      block.replaceWith(wrap);
      return;
    }
    if (block && block.parentElement) {
      var onlyThis = (block.textContent || '').trim() === (a.textContent || '').trim()
        && block.querySelectorAll('a, img, video, iframe').length <= 1;
      if (onlyThis && !block.classList.contains('ck-content')) {
        block.replaceWith(wrap);
        return;
      }
    }
    a.replaceWith(wrap);
  }

  /** 방문자 패스: 로컬 동영상 링크 → <video> 승격 */
  function videoRenderVisitor(scope, cfg, ctx) {
    // 링크 텍스트(파일명일 수도, URL일 수도)와 무관하게 href 패턴만으로 잡는다.
    var vAnchors = scope.querySelectorAll('a[href]');
    for (var vi = 0; vi < vAnchors.length; vi++) {
      var va = vAnchors[vi];
      if (!videoIdOf(va.getAttribute('href') || va.href)) continue;
      if (va.closest('.ck5-video')) continue;
      var vblk = va.closest('p, div, figure');
      if (vblk && vblk !== scope) vblk.dataset.ck5Lc = 'video';
      ctx.once('video', injectVideoStyle);
      promoteVideoAnchor(va);
    }
  }

  core.section({
    name: 'video-render',
    scope: 'visitor',
    order: 30,
    load: 'eager',
    gate: function (cfg) { return cfg.videoEnabled; },
    enabled: function (cfg) { return cfg.videoEnabled; },
    styles: [VIDEO_STYLE_ID],
    visitor: videoRenderVisitor
  });

