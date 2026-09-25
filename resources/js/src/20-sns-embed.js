  /* ================================================================ *
   *  SNS 임베드
   * ================================================================ */

  var EMBED_STYLE_ID = 'ck5-media-embed-style';

  var LABELS = { youtube: 'YouTube', twitter: 'X', instagram: 'Instagram', tiktok: 'TikTok', unknown: '' };

  var SCRIPTS = {
    twitter: {
      id: 'ck5-embed-twitter',
      src: 'https://platform.twitter.com/widgets.js',
      process: function () { if (window.twttr && window.twttr.widgets && window.twttr.widgets.load) window.twttr.widgets.load(); }
    },
    instagram: {
      id: 'ck5-embed-instagram',
      src: 'https://www.instagram.com/embed.js',
      process: function () { if (window.instgrm && window.instgrm.Embeds && window.instgrm.Embeds.process) window.instgrm.Embeds.process(); }
    },
    tiktok: {
      id: 'ck5-embed-tiktok',
      src: 'https://www.tiktok.com/embed.js',
      process: function () { reinjectTiktok(); }
    }
  };

  function bare(rawUrl) {
    return String(rawUrl).trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  }

  function detectPlatform(rawUrl) {
    var u = bare(rawUrl);
    if (/^(youtube\.com\/(watch\?|shorts\/|embed\/|live\/|v\/)|youtu\.be\/|m\.youtube\.com\/)/i.test(u)) return 'youtube';
    if (/^(twitter\.com|x\.com)\/[^/]+\/status(?:es)?\/\d+/i.test(u)) return 'twitter';
    if (/^instagram\.com\/(p|reel|reels|tv)\//i.test(u)) return 'instagram';
    if (/^(?:vm|vt)\.tiktok\.com\//i.test(u) || /^tiktok\.com\/(@[^/]+\/video\/\d+|t\/|embed\/)/i.test(u)) return 'tiktok';
    return 'unknown';
  }

  function youtubeId(rawUrl) {
    var u = bare(rawUrl);
    var m = u.match(/^youtu\.be\/([\w-]{6,})/i)
      || u.match(/[?&]v=([\w-]{6,})/i)
      || u.match(/^(?:m\.)?youtube\.com\/(?:shorts|embed|live|v)\/([\w-]{6,})/i);
    return m ? m[1] : null;
  }

  /** 임베드용 정규 URL — 추적/동의 파라미터 제거 (임베드 파서가 빈 박스를 만드는 원인) */
  function canonicalUrl(rawUrl, platform) {
    var noHash = String(rawUrl).trim().split('#')[0];
    var path = noHash.split('?')[0];
    var m;
    switch (platform) {
      case 'twitter':
        m = bare(path).match(/^(twitter\.com|x\.com)\/([^/]+)\/status(?:es)?\/(\d+)/i);
        return m ? 'https://' + m[1].toLowerCase() + '/' + m[2] + '/status/' + m[3] : path;
      case 'instagram':
        m = bare(path).match(/^instagram\.com\/(p|reel|reels|tv)\/([\w-]+)/i);
        return m ? 'https://www.instagram.com/' + (m[1] === 'reels' ? 'reel' : m[1]) + '/' + m[2] + '/' : path;
      case 'tiktok':
        m = bare(path).match(/^tiktok\.com\/(@[^/]+)\/video\/(\d+)/i);
        return m ? 'https://www.tiktok.com/' + m[1] + '/video/' + m[2] : path;
      case 'youtube': {
        var id = youtubeId(rawUrl);
        return id ? 'https://www.youtube.com/watch?v=' + id : path;
      }
      default:
        return path;
    }
  }

  /** 항상 남는 하단 링크 — pill 버튼, 화살표 없음 */
  function footLink(url, platform) {
    var label = LABELS[platform]
      ? t('content.media_embed.view_on', LABELS[platform] + '에서 보기').replace('{platform}', LABELS[platform])
      : t('content.media_embed.open_link', '링크 열기');
    return '<div class="ck5-media-embed__foot">'
      + '<a class="ck5-media-embed__btn" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + '</a>'
      + '</div>';
  }

  function unsupportedFallback(url) {
    return '<div class="ck5-media-embed__notice">'
      + esc(t('content.media_embed.unsupported', '지원하지 않는 임베드입니다. 링크로 표시합니다.'))
      + '</div>'
      + footLink(url, 'unknown');
  }

  function embedMarkup(platform, url, rawUrl) {
    var m;
    switch (platform) {
      case 'youtube': {
        var id = youtubeId(rawUrl);
        if (!id) return unsupportedFallback(url);
        var shortsClass = /\/shorts\//i.test(rawUrl) ? ' ck5-media-embed__yt--shorts' : '';
        return '<div class="ck5-media-embed__yt' + shortsClass + '">'
          + '<iframe src="https://www.youtube-nocookie.com/embed/' + esc(id) + '" title="YouTube video" '
          + 'loading="lazy" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" '
          + 'referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>'
          + '</div>'
          + footLink(url, platform);
      }
      case 'twitter':
        return '<blockquote class="twitter-tweet" data-dnt="true"><a href="' + esc(url) + '"></a></blockquote>' + footLink(url, platform);
      case 'instagram':
        return '<blockquote class="instagram-media" data-instgrm-permalink="' + esc(url) + '" data-instgrm-version="14" '
          + 'style="max-width:540px;width:100%;margin:0 auto;"><a href="' + esc(url) + '"></a></blockquote>'
          + footLink(url, platform);
      case 'tiktok': {
        m = url.match(/\/video\/(\d+)/);
        var idAttr = m ? ' data-video-id="' + esc(m[1]) + '"' : '';
        return '<blockquote class="tiktok-embed" cite="' + esc(url) + '"' + idAttr + ' '
          + 'style="max-width:605px;min-width:325px;margin:0 auto;"><a href="' + esc(url) + '"></a></blockquote>'
          + footLink(url, platform);
      }
      default:
        return unsupportedFallback(url);
    }
  }

  var scriptStates = {}; // id -> 'loading' | 'ready' | 'error'

  function loadScript(platform) {
    var spec = SCRIPTS[platform];
    var state = scriptStates[spec.id];
    if (state === 'ready') { scheduleProcess(platform); return; }
    if (state === 'loading') return;
    if (document.getElementById(spec.id)) {
      scriptStates[spec.id] = 'ready';
      scheduleProcess(platform);
      return;
    }
    scriptStates[spec.id] = 'loading';
    var s = document.createElement('script');
    s.id = spec.id;
    s.async = true;
    s.src = spec.src;
    s.onload = function () { scriptStates[spec.id] = 'ready'; scheduleProcess(platform); };
    s.onerror = function () {
      scriptStates[spec.id] = 'error';
      logger.warn('임베드 스크립트 로드 실패 (' + platform + ') — 링크로 대체됩니다.');
    };
    document.body.appendChild(s);
  }

  /** TikTok embed.js 재삽입 (동적 삽입분 재스캔용) — 미변환 blockquote 가 남았을 때만 */
  function reinjectTiktok() {
    var bqs = document.querySelectorAll('blockquote.tiktok-embed');
    var pending = false;
    for (var i = 0; i < bqs.length; i++) {
      var bq = bqs[i];
      var next = bq.nextElementSibling;
      if (!bq.querySelector('iframe') && !(next && next.matches && next.matches('iframe'))) { pending = true; break; }
    }
    if (!pending) return;
    var spec = SCRIPTS.tiktok;
    var old = document.getElementById(spec.id);
    if (old) old.remove();
    var s = document.createElement('script');
    s.id = spec.id;
    s.async = true;
    s.src = spec.src;
    document.body.appendChild(s);
    scriptStates[spec.id] = 'ready';
  }

  function scheduleProcess(platform, attempt) {
    attempt = attempt || 0;
    var ready = platform === 'twitter' ? !!(window.twttr && window.twttr.widgets)
      : platform === 'instagram' ? !!(window.instgrm && window.instgrm.Embeds)
      : true;
    if (ready) {
      try { SCRIPTS[platform].process(); } catch (e) { logger.warn('임베드 처리 오류 (' + platform + ')', e); }
      return;
    }
    if (attempt >= 40) return;
    window.setTimeout(function () { scheduleProcess(platform, attempt + 1); }, 300);
  }

  var pendingPlatforms = {};
  var flushTimer = null;

  function queuePlatform(platform) {
    pendingPlatforms[platform] = true;
    if (flushTimer !== null) return;
    flushTimer = window.setTimeout(function () {
      flushTimer = null;
      var list = Object.keys(pendingPlatforms);
      pendingPlatforms = {};
      list.forEach(loadScript);
    }, 50);
  }

  function reprocessPresent() {
    ['twitter', 'instagram', 'tiktok'].forEach(function (p) {
      if (document.querySelector('.' + EMBED_WRAPPER_CLASS + '[data-ck5-embed-platform="' + p + '"]')
        && scriptStates[SCRIPTS[p].id] === 'ready') {
        scheduleProcess(p);
      }
    });
  }

  function injectEmbedStyle(cfg) {
    var existing = document.getElementById(EMBED_STYLE_ID);
    var W = '.' + EMBED_WRAPPER_CLASS;
    var P = function (name) { return W + '[data-ck5-embed-platform="' + name + '"]'; };
    var css = ''
      + W + '{margin:1.1em 0;max-width:100%;text-align:center;}'
      + W + '>iframe,' + W + '>.twitter-tweet{margin-left:auto!important;margin-right:auto!important;}'
      + W + ' blockquote{border:0!important;padding:0!important;margin-left:auto!important;margin-right:auto!important;font-style:normal!important;overflow:visible!important;}'
      + W + '__yt{position:relative;width:100%;max-width:720px;margin:0 auto;aspect-ratio:16/9;background:#000;border-radius:10px;overflow:hidden;}'
      + W + '__yt--shorts{max-width:300px;aspect-ratio:' + cfg.shortsRatio + ';}'
      + W + '__yt>iframe{position:absolute;inset:0;width:100%;height:100%;border:0;}'
      + W + '__notice{color:#6b7280;font-size:.875rem;line-height:1.5;margin-bottom:.35em;}'
      + 'html.dark ' + W + '__notice{color:#9ca3af;}'
      + W + '__foot{margin-top:.65em;text-align:center;line-height:1;}'
      + W + '__btn{display:inline-block;padding:6px 16px;border-radius:9999px;font-size:.8125rem;font-weight:600;text-decoration:none;line-height:1.5;background:#e5e7eb;color:#1f2937;transition:background .15s,color .15s,filter .15s;}'
      + W + '__btn:hover{background:#d1d5db;}'
      + 'html.dark ' + W + '__btn{background:#374151;color:#f3f4f6;}'
      + 'html.dark ' + W + '__btn:hover{background:#4b5563;}'
      + P('youtube') + ' ' + W + '__btn{background:#fee2e2;color:#b91c1c;}'
      + P('youtube') + ' ' + W + '__btn:hover{background:#fecaca;}'
      + 'html.dark ' + P('youtube') + ' ' + W + '__btn{background:#7f1d1d;color:#fecaca;}'
      + 'html.dark ' + P('youtube') + ' ' + W + '__btn:hover{background:#991b1b;}'
      + P('twitter') + ' ' + W + '__btn{background:#e5e7eb;color:#0f172a;}'
      + P('twitter') + ' ' + W + '__btn:hover{background:#cbd5e1;}'
      + 'html.dark ' + P('twitter') + ' ' + W + '__btn{background:#1f2937;color:#f8fafc;}'
      + 'html.dark ' + P('twitter') + ' ' + W + '__btn:hover{background:#334155;}'
      + P('instagram') + ' ' + W + '__btn{background:linear-gradient(95deg,#feda75,#fa7e1e 28%,#d62976 58%,#962fbf 82%,#4f5bd5);color:#fff;}'
      + P('instagram') + ' ' + W + '__btn:hover{filter:brightness(.93);}'
      + P('tiktok') + ' ' + W + '__btn{background:#111827;color:#fff;}'
      + P('tiktok') + ' ' + W + '__btn:hover{background:#000;}'
      + 'html.dark ' + P('tiktok') + ' ' + W + '__btn{background:#0b1220;}';
    if (existing) { existing.textContent = css; return; }
    var el = document.createElement('style');
    el.id = EMBED_STYLE_ID;
    el.textContent = css;
    document.head.appendChild(el);
  }

  /**
   * 임베드 대상 하나를 변환한다.
   * @param target  교체 대상 Element (본문 <p> 블록 또는 레거시 <figure.media>/<oembed>)
   * @param rawUrl  원본 URL
   * @param platform  detectPlatform 결과
   * @param cfg  설정
   */
  function transformEmbed(target, rawUrl, platform, cfg) {
    if (target.parentElement && target.parentElement.classList.contains(EMBED_WRAPPER_CLASS)) return;

    // 플랫폼이 꺼져 있으면: 임베드하지 않고 순수 링크로 남긴다 (레거시 <oembed> 는 <a> 로 환원).
    if (platform !== 'unknown' && !platformEnabled(cfg, platform)) {
      if (target.tagName === 'OEMBED' || (target.tagName === 'FIGURE' && target.classList.contains('media'))) {
        var p = document.createElement('p');
        var a = document.createElement('a');
        a.href = rawUrl;
        a.textContent = rawUrl;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        p.appendChild(a);
        target.replaceWith(p);
      }
      return;
    }

    var url = canonicalUrl(rawUrl, platform);
    var wrapper = document.createElement('div');
    wrapper.className = EMBED_WRAPPER_CLASS;
    wrapper.setAttribute('data-ck5-embed-platform', platform);
    wrapper.innerHTML = embedMarkup(platform, url, rawUrl);
    target.replaceWith(wrapper);

    if (platform === 'twitter' || platform === 'instagram' || platform === 'tiktok') {
      queuePlatform(platform);
    }
  }

  /** 플랫폼별 렌더 허용 여부 (플랫폼 마스터 토글 && 개별 토글) */
  function platformEnabled(cfg, platform) {
    if (!cfg.snsEnabled) return false;
    switch (platform) {
      case 'youtube': return cfg.snsYoutube;
      case 'twitter': return cfg.snsTwitter;
      case 'instagram': return cfg.snsInstagram;
      case 'tiktok': return cfg.snsTiktok;
      default: return false;
    }
  }

