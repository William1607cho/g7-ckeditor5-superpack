/**
 * g7-ckeditor5-superpack — 프론트 렌더 엔트리 (global 전략, 전 페이지 로드)
 *
 * CKEditor 5(`sirsoft-ckeditor5`)로 작성한 본문에는 링크가 순수 `<a href>` 로만 저장된다.
 * 이 스크립트가 방문자 화면에서 `.ck-content` 를 스캔해:
 *
 *  1. 단독으로 놓인 SNS 링크(YouTube·X·Instagram·TikTok)를 각 플랫폼 임베드로 치환
 *  2. 그 밖의 단독 외부 링크를 서버 프리뷰 API 로 조회해 OG 카드 / 최소 카드로 치환
 *
 * 설정은 `window.G7Config.plugins['g7-ckeditor5-superpack']` (관리자 설정의 frontend_schema
 * 노출분)에서 읽는다. 기능이 꺼져 있으면 해당 스캔을 건너뛴다.
 *
 * 설계 원칙:
 *  - **CKEditor 본체를 건드리지 않는다** — 저장 데이터는 `<a href>` 뿐. 임베드/카드는 화면에서만.
 *  - **멱등** — 대상 노드를 교체하며 처리표시를 남겨 재실행해도 중복 생성이 없다.
 *  - **조용히 깨지지 않는다** — 임베드는 하단에 항상 원문 링크 버튼을 남기고, 카드화 실패 시
 *    원본 링크를 그대로 둔다(긴 URL 은 CSS 로 자동 줄바꿈).
 *  - **SPA 대응** — DOMContentLoaded + rAF + 지연 재시도 + body MutationObserver.
 *
 * (레거시: `sirsoft-ckeditor5` 다운스트림 포크가 previewsInData:false 로 저장하던
 *  `<figure class="media"><oembed url></oembed></figure>` 형태도 함께 처리한다 — 있으면.)
 */
(function () {
  'use strict';

  var IDENTIFIER = 'g7-ckeditor5-superpack';
  var API = '/api/plugins/' + IDENTIFIER + '/link-preview';

  var EMBED_WRAPPER_CLASS = 'ck5-media-embed';
  var EMBED_STYLE_ID = 'ck5-media-embed-style';
  var LINKCARD_STYLE_ID = 'ck5-linkcard-style';
  var MAX_INFLIGHT = 3;

  var logger = (window.G7Core && window.G7Core.createLogger && window.G7Core.createLogger('Plugin:' + IDENTIFIER)) || {
    log: function () {},
    warn: function () {},
    error: function () {}
  };

  /* ================================================================ *
   *  설정
   * ================================================================ */

  function asBool(value, fallback) {
    if (value === undefined || value === null) return fallback;
    if (typeof value === 'string') return value !== 'false' && value !== '0' && value !== '';
    return Boolean(value);
  }

  function asInt(value, fallback, min, max) {
    var n = parseInt(value, 10);
    if (!isFinite(n)) n = fallback;
    return Math.max(min, Math.min(max, n));
  }

  function readSettings() {
    var s = (window.G7Config && window.G7Config.plugins && window.G7Config.plugins[IDENTIFIER]) || {};
    var ratio = String(s.sns_shorts_ratio || '9/16');
    if (!/^\d{1,2}\/\d{1,2}$/.test(ratio)) ratio = '9/16';
    return {
      snsEnabled: asBool(s.sns_enabled, true),
      snsYoutube: asBool(s.sns_youtube, true),
      snsTwitter: asBool(s.sns_twitter, true),
      snsInstagram: asBool(s.sns_instagram, true),
      snsTiktok: asBool(s.sns_tiktok, true),
      shortsRatio: ratio,
      linkcardEnabled: asBool(s.linkcard_enabled, true),
      linkcardMinimal: asBool(s.linkcard_minimal_enabled, true),
      imageSize: asInt(s.linkcard_image_size, 168, 80, 400),
      videoEnabled: asBool(s.video_enabled, true),
      videoMaxMb: asInt(s.video_max_mb, 200, 1, 2048),
      videoChunkMb: asInt(s.video_chunk_mb, 20, 1, 28),
      videoAllowMov: asBool(s.video_allow_mov, true),
      videoAllowWebm: asBool(s.video_allow_webm, true),
      videoAllowM4v: asBool(s.video_allow_m4v, false),
      mdEnabled: asBool(s.md_enabled, true),
      mdHeading: asBool(s.md_heading, true),
      mdBold: asBool(s.md_bold, true),
      mdItalic: asBool(s.md_italic, false),
      mdList: asBool(s.md_list, true),
      mdLink: asBool(s.md_link, true),
      mdCode: asBool(s.md_code, true),
      mdQuote: asBool(s.md_quote, true),
      mdTable: asBool(s.md_table, true),
      mdHr: asBool(s.md_hr, true),
      editorStyleEnabled: asBool(s.editor_style_enabled, false),
      editorFontSize: asInt(s.editor_font_size, 16, 12, 28),
      editorLineHeight: asLineHeight(s.editor_line_height, '1.6'),
      editorApplyToComments: asBool(s.editor_apply_to_comments, false),
      imagePasteEnabled: asBool(s.imagepaste_enabled, true)
    };
  }

  /** 줄간격은 Select 로 고정된 프리셋 값만 허용(임의 값 유입 방지, 레이아웃 파손 방어). */
  function asLineHeight(value, fallback) {
    var allowed = ['1.2', '1.4', '1.6', '1.8', '2.0'];
    var v = String(value == null ? '' : value);
    return allowed.indexOf(v) !== -1 ? v : fallback;
  }

  /** 설정에 따른 허용 동영상 확장자 목록 (소문자, .mp4 항상 포함) */
  function allowedVideoExts(cfg) {
    var e = ['mp4'];
    if (cfg.videoAllowMov) e.push('mov');
    if (cfg.videoAllowWebm) e.push('webm');
    if (cfg.videoAllowM4v) e.push('m4v');
    return e;
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

  /* ================================================================ *
   *  공통 유틸
   * ================================================================ */

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function t(key, fallback) {
    var translate = window.G7Core && window.G7Core.t;
    if (typeof translate !== 'function') return fallback;
    var full = IDENTIFIER + '.' + key;
    var r = translate(full);
    return (typeof r === 'string' && r !== full) ? r : fallback;
  }

  /* ================================================================ *
   *  SNS 임베드
   * ================================================================ */

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

  /* ================================================================ *
   *  링크 카드
   * ================================================================ */

  function isBareUrlLink(a) {
    var href = a.getAttribute('href') || '';
    if (!/^https?:\/\//i.test(href)) return false;
    var text = (a.textContent || '').trim();
    if (!/^https?:\/\//i.test(text)) return false;
    var norm = function (u) { return u.replace(/\/+$/, '').toLowerCase(); };
    return norm(text) === norm(href);
  }

  /** block(주로 <p>)의 유일한 의미 있는 자식이 맨URL 링크면 그 링크를 반환 */
  function soleLinkOf(block) {
    if ((block.textContent || '').trim() === '') return null;
    var els = [];
    for (var i = 0; i < block.children.length; i++) els.push(block.children[i]);
    if (els.length !== 1) return null;
    var only = els[0];
    if (only.tagName !== 'A') return null;
    if ((block.textContent || '').trim() !== (only.textContent || '').trim()) return null;
    return isBareUrlLink(only) ? only : null;
  }

  function cardHtml(url, p, cfg) {
    var title = (p.title || p.domain || url).trim();
    var desc = (p.description || '').trim();
    var domain = (p.domain || '').trim();
    var img = (p.image || '').trim();
    var imgPart = img
      ? '<div class="ck5-linkcard__thumb"><img src="' + esc(img) + '" alt="" loading="lazy" referrerpolicy="no-referrer"></div>'
      : '';
    return '<a class="ck5-linkcard' + (img ? '' : ' ck5-linkcard--noimg') + '" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer nofollow">'
      + imgPart
      + '<div class="ck5-linkcard__body">'
      + '<div class="ck5-linkcard__title">' + esc(title) + '</div>'
      + (desc ? '<div class="ck5-linkcard__desc">' + esc(desc) + '</div>' : '')
      + '<div class="ck5-linkcard__domain">' + esc(domain || url) + '</div>'
      + '</div>'
      + '</a>';
  }

  function minimalCardHtml(url, p) {
    var title = (p.title || p.domain || url).trim();
    var domain = (p.domain || '').trim();
    var fav = (p.favicon || '').trim();
    var favPart = fav
      ? '<div class="ck5-linkcard__favwrap"><img class="ck5-linkcard__favicon" src="' + esc(fav) + '" alt="" loading="lazy" referrerpolicy="no-referrer" width="18" height="18"></div>'
      : '';
    return '<a class="ck5-linkcard ck5-linkcard--minimal" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer nofollow">'
      + favPart
      + '<div class="ck5-linkcard__body">'
      + '<div class="ck5-linkcard__title">' + esc(title) + '</div>'
      + '<div class="ck5-linkcard__domain">' + esc(domain || url) + '</div>'
      + '</div>'
      + '</a>';
  }

  var previewCache = {}; // url -> Preview
  var previewPending = {}; // url -> Promise (진행 중·429 재시도 대기 중, 같은 URL 은 요청을 공유)
  var inflight = 0;
  var fetchQueue = [];
  var RETRY_LATER = {};

  function pump() {
    while (inflight < MAX_INFLIGHT && fetchQueue.length > 0) {
      (fetchQueue.shift())();
    }
  }

  /**
   * 429 의 Retry-After(초)로 재시도 대기 시간(ms)을 정한다. 재시도하지 않으면 null.
   * 없음 → 2초, 10초 이하 → 그 값. 10초 초과·숫자 아님 → null. 둘 다 0~999ms 무작위 지연을 더한다.
   */
  function previewRetryDelay(retryAfter) {
    var jitter = Math.floor(Math.random() * 1000);
    if (retryAfter === null || retryAfter === undefined || String(retryAfter).trim() === '') return 2000 + jitter;
    var v = String(retryAfter).trim();
    if (!/^\d+$/.test(v)) return null;
    var sec = parseInt(v, 10);
    return sec > 10 ? null : sec * 1000 + jitter;
  }

  /** 요청 1회를 큐에 넣는다. 첫 429 는 캐시하지 않고 한 번만 다시 넣는다. */
  function requestPreview(url, retried, finish) {
    fetchQueue.push(function () {
      inflight++;
      var waitMs = null;
      var done = function (p) {
        inflight--;
        finish(p);
        pump();
      };
      fetch(API + '?url=' + encodeURIComponent(url), { headers: { Accept: 'application/json' } })
        .then(function (r) {
          if (r.status === 429 && !retried) {
            waitMs = previewRetryDelay(r.headers.get('Retry-After'));
            if (waitMs !== null) return RETRY_LATER;
          }
          return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status));
        })
        .then(function (p) {
          if (p === RETRY_LATER) {
            inflight--;
            pump();
            window.setTimeout(function () { requestPreview(url, true, finish); }, waitMs);
            return;
          }
          done(p && typeof p === 'object' ? p : { status: 'failed' });
        })
        .catch(function () { done({ status: 'failed' }); });
    });
    pump();
  }

  function getPreview(url) {
    if (previewCache[url]) return Promise.resolve(previewCache[url]);
    if (previewPending[url]) return previewPending[url];
    previewPending[url] = new Promise(function (resolve) {
      requestPreview(url, false, function (p) {
        previewCache[url] = p;
        delete previewPending[url];
        resolve(p);
      });
    });
    return previewPending[url];
  }

  function applyCard(target, url, p, kind, cfg) {
    var usable = p.status === 'ok' || (p.status === 'minimal' && cfg.linkcardMinimal);
    if (!usable) {
      target.dataset.ck5Lc = 'skip'; // 원본 링크 유지 + 재시도 방지
      return;
    }
    var minimal = p.status === 'minimal';

    var holder = document.createElement('div');
    holder.className = 'ck5-linkcard-wrap';
    holder.dataset.ck5Lc = 'done';
    holder.innerHTML = minimal ? minimalCardHtml(url, p) : cardHtml(url, p, cfg);

    var cardEl = holder.querySelector('.ck5-linkcard');

    var imgEl = holder.querySelector('.ck5-linkcard__thumb img');
    if (imgEl && cardEl) {
      var demote = function () { cardEl.classList.add('ck5-linkcard--noimg'); };
      imgEl.addEventListener('error', demote, { once: true });
      var to = window.setTimeout(function () {
        if (!imgEl.complete || imgEl.naturalWidth === 0) demote();
      }, 6000);
      imgEl.addEventListener('load', function () {
        window.clearTimeout(to);
        if (imgEl.naturalWidth < 120 || imgEl.naturalHeight < 120) demote();
      }, { once: true });
    }

    var favEl = holder.querySelector('.ck5-linkcard__favicon');
    if (favEl) {
      favEl.addEventListener('error', function () {
        var w = favEl.closest('.ck5-linkcard__favwrap');
        if (w) w.remove();
      }, { once: true });
    }

    if (kind === 'fallback') {
      target.innerHTML = '';
      target.appendChild(holder.firstElementChild);
      target.dataset.ck5Lc = 'done';
    } else {
      target.replaceWith(holder);
    }
  }

  function injectLinkCardStyle(cfg) {
    var sz = cfg.imageSize;
    var css = ''
      + '.ck5-linkcard-wrap{margin:1em 0;}'
      + '.ck5-linkcard{display:flex;align-items:stretch;gap:0;max-width:560px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;text-decoration:none;background:#fff;transition:border-color .15s,box-shadow .15s,background .15s;}'
      + '.ck5-linkcard:hover{border-color:#cbd5e1;box-shadow:0 2px 10px rgba(15,23,42,.08);}'
      + '.ck5-linkcard__thumb{flex:0 0 ' + sz + 'px;width:' + sz + 'px;height:' + sz + 'px;background:#f1f5f9;overflow:hidden;}'
      + '.ck5-linkcard__thumb>img{width:' + sz + 'px;height:' + sz + 'px;object-fit:cover;object-position:center;display:block;}'
      + '.ck5-linkcard--noimg .ck5-linkcard__thumb{display:none;}'
      + '.ck5-linkcard__body{flex:1 1 auto;min-width:0;padding:12px 14px;display:flex;flex-direction:column;gap:4px;justify-content:center;}'
      + '.ck5-linkcard__title{font-weight:600;font-size:.9375rem;line-height:1.35;color:#0f172a;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}'
      + '.ck5-linkcard__desc{font-size:.8125rem;line-height:1.45;color:#475569;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}'
      + '.ck5-linkcard__domain{font-size:.75rem;color:#94a3b8;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}'
      + '@media (max-width:520px){.ck5-linkcard{flex-direction:column;}.ck5-linkcard__thumb{flex-basis:auto;width:100%;height:' + sz + 'px;}.ck5-linkcard__thumb>img{width:100%;height:' + sz + 'px;}}'
      + 'html.dark .ck5-linkcard{background:#1e293b;border-color:#334155;}'
      + 'html.dark .ck5-linkcard:hover{border-color:#475569;box-shadow:0 2px 10px rgba(0,0,0,.35);}'
      + 'html.dark .ck5-linkcard__thumb{background:#0f172a;}'
      + 'html.dark .ck5-linkcard__title{color:#f1f5f9;}'
      + 'html.dark .ck5-linkcard__desc{color:#cbd5e1;}'
      + 'html.dark .ck5-linkcard__domain{color:#94a3b8;}'
      + '.ck5-linkcard--minimal{max-width:420px;border-style:dashed;background:#f8fafc;align-items:center;}'
      + '.ck5-linkcard--minimal:hover{border-color:#cbd5e1;box-shadow:none;}'
      + '.ck5-linkcard--minimal .ck5-linkcard__favwrap{flex:0 0 auto;display:flex;align-items:center;justify-content:center;padding-left:12px;}'
      + '.ck5-linkcard__favicon{width:18px;height:18px;object-fit:contain;display:block;}'
      + '.ck5-linkcard--minimal .ck5-linkcard__body{padding:9px 12px;gap:2px;}'
      + '.ck5-linkcard--minimal .ck5-linkcard__title{font-size:.875rem;-webkit-line-clamp:1;}'
      + 'html.dark .ck5-linkcard--minimal{background:#0f172a;border-color:#334155;}'
      + 'html.dark .ck5-linkcard--minimal:hover{border-color:#475569;box-shadow:none;}'
      + '.ck-content [data-ck5-lc="skip"] > a,.ck-content [data-ck5-lc="pending"] > a{word-break:break-all;overflow-wrap:break-word;white-space:normal;display:inline-block;max-width:100%;}';
    var existing = document.getElementById(LINKCARD_STYLE_ID);
    if (existing) { existing.textContent = css; return; }
    var el = document.createElement('style');
    el.id = LINKCARD_STYLE_ID;
    el.textContent = css;
    document.head.appendChild(el);
  }

  /* ================================================================ *
   *  로컬 동영상 — 렌더 승격 (방문자 화면)
   * ================================================================ */

  var VIDEO_STYLE_ID = 'ck5-video-style';
  // public_id 만 잡으면 되므로 상대/절대 URL 모두 매칭. 링크 텍스트는 상관 안 함.
  var VIDEO_URL_RE = /\/api\/plugins\/g7-ckeditor5-superpack\/video\/([a-f0-9]{32})\b/i;

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

  /* ================================================================ *
   *  로컬 동영상 — 편집 화면 업로드 UI (관리자)
   * ================================================================ */

  var UPLOAD_STYLE_ID = 'ck5-video-upload-style';
  var VIDEO_INIT = '/api/plugins/' + IDENTIFIER + '/video/upload/init';
  var VIDEO_CHUNK = '/api/plugins/' + IDENTIFIER + '/video/upload/chunk';
  var VIDEO_COMPLETE = '/api/plugins/' + IDENTIFIER + '/video/upload/complete';

  function authToken() {
    try {
      if (window.G7Core && window.G7Core.apiClient && window.G7Core.apiClient.getToken) {
        return window.G7Core.apiClient.getToken() || '';
      }
    } catch (e) {}
    try { return localStorage.getItem('auth_token') || ''; } catch (e) { return ''; }
  }

  function injectUploadStyle() {
    if (document.getElementById(UPLOAD_STYLE_ID)) return;
    var el = document.createElement('style');
    el.id = UPLOAD_STYLE_ID;
    // 편집기 본문의 동영상 링크 = 박스형 카드. class/data-* 는 CKEditor Link 가 지우므로
    // (실측) **href 속성 선택자**로만 스타일. 조회 화면(.ck-content, editable 밖)엔 미적용.
    var VBOX = '.ck-editor__editable a[href*="/api/plugins/g7-ckeditor5-superpack/video/"]';
    el.textContent = ''
      + '.ck5sp-vbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:6px 0 2px;font-size:13px;}'
      + '.ck5sp-vbar__btn{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border:1px solid #cbd5e1;border-radius:8px;background:#f8fafc;color:#0f172a;cursor:pointer;font-weight:600;line-height:1.2;}'
      + '.ck5sp-vbar__btn:hover{background:#eef2f7;}'
      + '.ck5sp-vbar__btn[disabled]{opacity:.55;cursor:default;}'
      + 'html.dark .ck5sp-vbar__btn{background:#1e293b;border-color:#334155;color:#e2e8f0;}'
      + '.ck5sp-vbar__hint{color:#64748b;}'
      + 'html.dark .ck5sp-vbar__hint{color:#94a3b8;}'
      + '.ck5sp-vbar__prog{flex:1 1 160px;min-width:120px;height:8px;border-radius:9999px;background:#e2e8f0;overflow:hidden;display:none;}'
      + 'html.dark .ck5sp-vbar__prog{background:#334155;}'
      + '.ck5sp-vbar__prog>span{display:block;height:100%;width:0;background:#2563eb;transition:width .2s;}'
      + '.ck5sp-vbar__msg{color:#b91c1c;}'
      + 'html.dark .ck5sp-vbar__msg{color:#fca5a5;}'
      // ---- 미디어 라이브러리 스트립 (편집기 위) ----
      + '.ck5sp-vlib{margin:6px 0 10px;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc;padding:8px 10px;}'
      + 'html.dark .ck5sp-vlib{background:#0f172a;border-color:#334155;}'
      + '.ck5sp-vlib[hidden]{display:none;}'
      + '.ck5sp-vlib__head{font-size:12px;font-weight:600;color:#475569;margin-bottom:6px;}'
      + 'html.dark .ck5sp-vlib__head{color:#94a3b8;}'
      + '.ck5sp-vlib__list{display:flex;flex-wrap:wrap;gap:10px;}'
      + '.ck5sp-vlib__card{width:210px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;background:#fff;}'
      + 'html.dark .ck5sp-vlib__card{background:#1e293b;border-color:#334155;}'
      + '.ck5sp-vlib__card>video{display:block;width:100%;height:112px;object-fit:cover;background:#000;}'
      + '.ck5sp-vlib__name{font-size:11px;color:#475569;padding:5px 7px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}'
      + 'html.dark .ck5sp-vlib__name{color:#cbd5e1;}'
      + '.ck5sp-vlib__row{display:flex;align-items:center;gap:4px;padding:5px 7px 7px;}'
      + '.ck5sp-vlib__sz{border:1px solid #cbd5e1;background:#f1f5f9;color:#475569;border-radius:5px;font-size:10px;line-height:1;padding:3px 6px;cursor:pointer;}'
      + '.ck5sp-vlib__sz.is-on{background:#2563eb;border-color:#2563eb;color:#fff;}'
      + 'html.dark .ck5sp-vlib__sz{background:#334155;border-color:#475569;color:#cbd5e1;}'
      + '.ck5sp-vlib__ins{margin-left:auto;border:0;background:#2563eb;color:#fff;border-radius:6px;font-size:11px;font-weight:600;padding:4px 9px;cursor:pointer;}'
      + '.ck5sp-vlib__ins:hover{background:#1d4ed8;}'
      // ---- 편집기 본문 박스 카드 (href 속성 선택자, GHS 무관) ----
      + VBOX + '{display:flex!important;align-items:center;justify-content:center;box-sizing:border-box;'
      +   'width:480px;max-width:100%;min-height:120px;margin:10px auto;padding:12px 16px;'
      +   'border:1px solid #cbd5e1;border-radius:10px;background:#f1f5f9;color:#0f172a!important;'
      +   'font-weight:600;text-decoration:none!important;text-align:center;line-height:1.4;word-break:break-all;}'
      + VBOX + '::before{content:"\\25B6";margin-right:8px;color:#2563eb;font-size:13px;flex-shrink:0;}'
      + VBOX + '[href*="size=sm"]{width:320px;min-height:92px;}'
      + VBOX + '[href*="size=lg"]{width:640px;min-height:184px;}'
      + 'html.dark ' + VBOX + '{background:#1e293b;border-color:#334155;color:#e2e8f0!important;}'
      + 'html.dark ' + VBOX + '::before{color:#60a5fa;}';
    document.head.appendChild(el);
  }

  /** 살아있는 CKEditor 인스턴스를 컨테이너 근처에서 찾는다. */
  function editorInstanceNear(container) {
    var scopes = [container, container.parentElement, container.nextElementSibling, document];
    for (var i = 0; i < scopes.length; i++) {
      var sc = scopes[i];
      if (!sc || !sc.querySelectorAll) continue;
      var eds = sc.querySelectorAll('.ck-editor__editable_inline, .ck-editor__editable');
      for (var j = 0; j < eds.length; j++) {
        if (eds[j].ckeditorInstance) return eds[j].ckeditorInstance;
      }
    }
    return null;
  }

  /** URL 에 size 힌트를 얹는다 ('md' 는 파라미터 없음 = 기본). GHS 는 href 쿼리는 보존함(실측). */
  function videoUrlWithSize(url, size) {
    var base = String(url).replace(/[?&]size=(sm|md|lg)\b/gi, '').replace(/[?&]$/, '');
    if (size === 'sm' || size === 'lg') {
      base += (base.indexOf('?') === -1 ? '?' : '&') + 'size=' + size;
    }
    return base;
  }

  /**
   * 동영상 링크 한 줄을 현재 커서 위치에 삽입한다.
   * 에디터가 포커스 아웃 등으로 선택이 유효하지 않으면 **문서 끝**에 삽입(자연스러운 폴백).
   *
   * CKEditor 5 43.3.1 은 GHS 와일드카드로도 `<video>`·`<a class>` 를 본문 모델에 담지
   * 못하므로(실측) 본문엔 순수 링크만. 편집 화면에선 href 속성 선택자 CSS 가 박스 카드로
   * 보이게 하고, 방문자 화면에선 렌더러가 `<video>` 로 승격한다.
   */
  function insertVideoLink(editor, url, name, size) {
    var u = videoUrlWithSize(url, size || 'md');
    var html = '<p><a href="' + esc(u) + '">' + esc(name || u) + '</a></p>';
    var mf;
    try {
      mf = editor.data.toModel(editor.data.processor.toView(html));
    } catch (e) {
      try { editor.setData((editor.getData() || '') + html); } catch (e1) {}
      try { editor.editing.view.focus(); } catch (e1) {}
      return;
    }
    var focused = false;
    try { focused = !!(editor.editing && editor.editing.view && editor.editing.view.document && editor.editing.view.document.isFocused); } catch (e) {}
    try {
      if (focused) editor.model.insertContent(mf);
      else editor.model.insertContent(mf, editor.model.document.getRoot(), 'end');
    } catch (e) {
      try { editor.setData((editor.getData() || '') + html); } catch (e2) {}
    }
    try { editor.editing.view.focus(); } catch (e) {}
  }

  function humanMb(bytes) { return (bytes / 1024 / 1024).toFixed(1); }

  /** 파일 하나를 청크로 업로드. onProgress(0..1), 완료 시 resolve({id,url,name}). */
  function chunkedUpload(file, cfg, onProgress) {
    var token = authToken();
    var headers = token ? { Authorization: 'Bearer ' + token } : {};
    var totalChunks = Math.max(1, Math.ceil(file.size / (cfg.videoChunkMb * 1024 * 1024)));

    return fetch(VIDEO_INIT, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json', Accept: 'application/json' }, headers),
      body: JSON.stringify({ filename: file.name, size: file.size, mime: file.type || 'video/mp4', total_chunks: totalChunks })
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.j && res.j.message ? res.j.message : 'init 실패');
        var sessionKey = res.j.session_key;
        var chunkSize = res.j.chunk_size || (cfg.videoChunkMb * 1024 * 1024);
        var count = Math.max(1, Math.ceil(file.size / chunkSize));

        var sendChunk = function (index) {
          if (index >= count) {
            return fetch(VIDEO_COMPLETE, {
              method: 'POST',
              headers: Object.assign({ 'Content-Type': 'application/json', Accept: 'application/json' }, headers),
              body: JSON.stringify({ session_key: sessionKey })
            }).then(function (r) {
              return r.json().then(function (j) {
                if (!r.ok) throw new Error(j && j.message ? j.message : 'complete 실패');
                return j;
              });
            });
          }
          var start = index * chunkSize;
          var blob = file.slice(start, Math.min(start + chunkSize, file.size));
          var fd = new FormData();
          fd.append('session_key', sessionKey);
          fd.append('index', String(index));
          fd.append('chunk', blob, 'chunk');
          return fetch(VIDEO_CHUNK, { method: 'POST', headers: headers, body: fd })
            .then(function (r) {
              return r.json().then(function (j) {
                if (!r.ok) throw new Error(j && j.message ? j.message : 'chunk ' + index + ' 실패');
                if (onProgress) onProgress((index + 1) / count);
                return sendChunk(index + 1);
              });
            });
        };
        return sendChunk(0);
      });
  }

  var VIDEO_META = '/api/plugins/' + IDENTIFIER + '/video/meta';

  /** 편집기 컨테이너 하나에 업로드 바 + 미디어 라이브러리를 붙인다 (중복 방지). */
  function attachUploaderTo(container) {
    if (container.__ck5spVideo) return;
    var cfg = readSettings();
    if (!cfg.videoEnabled) return;
    container.__ck5spVideo = true;
    injectUploadStyle();

    var exts = allowedVideoExts(cfg);
    var accept = exts.map(function (x) { return '.' + x; }).concat(['video/mp4', 'video/quicktime', 'video/webm']).join(',');

    var bar = document.createElement('div');
    bar.className = 'ck5sp-vbar';
    bar.innerHTML =
      '<button type="button" class="ck5sp-vbar__btn">' + esc(t('editor.video.button', '동영상 업로드')) + '</button>'
      + '<span class="ck5sp-vbar__hint">' + esc(t('editor.video.hint', '{exts} · 최대 {max}MB').replace('{exts}', exts.map(function (x) { return x.toUpperCase(); }).join('/')).replace('{max}', String(cfg.videoMaxMb))) + '</span>'
      + '<span class="ck5sp-vbar__prog"><span></span></span>'
      + '<span class="ck5sp-vbar__msg"></span>'
      + '<input type="file" accept="' + accept + '" hidden>';
    container.parentNode.insertBefore(bar, container);

    var btn = bar.querySelector('.ck5sp-vbar__btn');
    var input = bar.querySelector('input[type=file]');
    var prog = bar.querySelector('.ck5sp-vbar__prog');
    var progFill = prog.firstElementChild;
    var msg = bar.querySelector('.ck5sp-vbar__msg');

    // ---- 미디어 라이브러리 ----
    var lib = document.createElement('div');
    lib.className = 'ck5sp-vlib';
    lib.hidden = true;
    lib.innerHTML = '<div class="ck5sp-vlib__head">' + esc(t('editor.video.library', '동영상 라이브러리')) + '</div><div class="ck5sp-vlib__list"></div>';
    var libList = lib.querySelector('.ck5sp-vlib__list');
    container.parentNode.insertBefore(lib, container);

    var libIndex = {}; // videoId -> card element

    function currentEditor() { return editorInstanceNear(container); }

    /** 라이브러리 카드 추가 (동영상 id 기준 중복 제거). */
    function addLibCard(url, name, mime) {
      var id = videoIdOf(url);
      if (!id || libIndex[id]) return;
      lib.hidden = false;

      var card = document.createElement('div');
      card.className = 'ck5sp-vlib__card';
      card.setAttribute('data-vid', id);
      var baseUrl = videoUrlWithSize(url, 'md'); // 파라미터 제거된 순수 URL

      var v = document.createElement('video');
      v.controls = true; v.preload = 'metadata'; v.playsInline = true; v.src = baseUrl;
      card.appendChild(v);

      var nameEl = document.createElement('div');
      nameEl.className = 'ck5sp-vlib__name';
      nameEl.textContent = name || id;
      nameEl.title = name || id;
      card.appendChild(nameEl);

      var row = document.createElement('div');
      row.className = 'ck5sp-vlib__row';
      var size = 'md';
      ['sm', 'md', 'lg'].forEach(function (s) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'ck5sp-vlib__sz' + (s === size ? ' is-on' : '');
        b.textContent = t('editor.video.size_' + s, s === 'sm' ? '소' : (s === 'lg' ? '대' : '중'));
        b.addEventListener('click', function (ev) {
          ev.stopPropagation();
          size = s;
          row.querySelectorAll('.ck5sp-vlib__sz').forEach(function (x) { x.classList.remove('is-on'); });
          b.classList.add('is-on');
        });
        row.appendChild(b);
      });
      var ins = document.createElement('button');
      ins.type = 'button';
      ins.className = 'ck5sp-vlib__ins';
      ins.textContent = t('editor.video.insert', '본문에 삽입');
      var doInsert = function () {
        var ed = currentEditor();
        if (!ed) { msg.style.color = ''; msg.textContent = t('editor.video.err_editor', '에디터를 찾지 못했습니다. 잠시 후 다시 시도하세요.'); return; }
        insertVideoLink(ed, baseUrl, name || id, size);
      };
      ins.addEventListener('click', function (ev) { ev.stopPropagation(); doInsert(); });
      row.appendChild(ins);
      card.appendChild(row);

      libIndex[id] = card;
      libList.appendChild(card);
    }

    /** 에디터 본문(getData)에 이미 들어 있는 동영상들을 라이브러리에 채운다 (수정 화면 대응). */
    function hydrateFromEditor() {
      var ed = currentEditor();
      if (!ed) return;
      var data = '';
      try { data = ed.getData() || ''; } catch (e) { return; }
      var ids = [], m, re = /\/api\/plugins\/g7-ckeditor5-superpack\/video\/([a-f0-9]{32})\b/gi;
      while ((m = re.exec(data)) !== null) {
        var id = m[1].toLowerCase();
        if (ids.indexOf(id) === -1 && !libIndex[id]) ids.push(id);
      }
      if (!ids.length) return;
      var token = authToken();
      fetch(VIDEO_META, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json', Accept: 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
        body: JSON.stringify({ ids: ids })
      })
        .then(function (r) { return r.ok ? r.json() : []; })
        .then(function (list) {
          (Array.isArray(list) ? list : []).forEach(function (it) {
            if (it && it.url) addLibCard(it.url, it.name || '', it.mime || '');
          });
        })
        .catch(function () {});
    }
    // 편집기 콘텐츠가 늦게 세팅될 수 있어 몇 차례 시도
    [200, 800, 2000].forEach(function (ms) { window.setTimeout(hydrateFromEditor, ms); });

    btn.addEventListener('click', function () { msg.textContent = ''; input.click(); });

    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      var c = readSettings();
      var ext = (file.name.split('.').pop() || '').toLowerCase();
      if (allowedVideoExts(c).indexOf(ext) === -1) { msg.style.color = ''; msg.textContent = t('editor.video.err_ext', 'MP4 파일만 업로드할 수 있습니다.'); return; }
      if (file.size > c.videoMaxMb * 1024 * 1024) {
        msg.style.color = '';
        msg.textContent = t('editor.video.err_size', '파일이 너무 큽니다 (최대 {max}MB).').replace('{max}', String(c.videoMaxMb)).replace('{cur}', humanMb(file.size));
        return;
      }
      var editor = currentEditor();
      if (!editor) { msg.style.color = ''; msg.textContent = t('editor.video.err_editor', '에디터를 찾지 못했습니다. 잠시 후 다시 시도하세요.'); return; }

      btn.disabled = true;
      prog.style.display = 'block';
      progFill.style.width = '0%';
      var origLabel = btn.textContent;
      btn.textContent = t('editor.video.uploading', '업로드 중…');

      chunkedUpload(file, c, function (p) { progFill.style.width = Math.round(p * 100) + '%'; })
        .then(function (r) {
          var nm = r.name || file.name;
          addLibCard(r.url, nm, r.mime || file.type || '');
          insertVideoLink(editor, r.url, nm, 'md'); // 업로드 시 1회 자동 삽입 (기존 UX 유지)
          msg.style.color = '';
          msg.textContent = t('editor.video.done', '삽입되었습니다. 저장하면 게시글에서 재생됩니다.');
          window.setTimeout(function () { if (msg && msg.textContent === t('editor.video.done', '삽입되었습니다. 저장하면 게시글에서 재생됩니다.')) msg.textContent = ''; }, 6000);
        })
        .catch(function (e) {
          msg.style.color = '';
          msg.textContent = (e && e.message) ? e.message : t('editor.video.err_generic', '업로드에 실패했습니다.');
        })
        .then(function () {
          btn.disabled = false;
          btn.textContent = origLabel;
          prog.style.display = 'none';
        });
    });
  }

  /* ================================================================ *
   *  클립보드 이미지 붙여넣기 — 웹페이지 "이미지 복사" → 우리 서버 업로드
   * ================================================================ *
   *  CKEditor5 네이티브 ImageUpload 의 clipboardInput 리스너는(dist/vendor
   *  ckeditor5.umd.js 실측) `dataTransfer.types` 에 `text/html` 이 있고 그
   *  값이 비어있지 않으면 — 파일 바이너리가 함께 있어도 — 그냥 return 하고
   *  업로드를 시도하지 않는다. 브라우저에서 웹페이지 이미지를 "이미지 복사"하면
   *  많은 사이트가 클립보드에 실제 이미지 바이너리와 `<img src="외부URL">`
   *  text/html 을 동시에 담으므로, 네이티브 경로로는 바이너리를 무시하고 외부
   *  URL 이 그대로 본문에 삽입된다(화면엔 정상 렌더 → 원본 삭제/핫링크 차단 시
   *  깨지는 조용한 실패).
   *
   *  여기서는 `document` 캡처 단계에서 paste 를 먼저 가로채(도달 순서상 항상
   *  에디터 자신의 리스너보다 앞선다) 클립보드 아이템 중 kind==='file' &&
   *  type이 'image/'로 시작하는 바이너리가 있으면, 그 즉시 htm 처리를 막고
   *  기존 로컬 업로드 경로(SimpleUploadAdapter → sirsoft-ckeditor5 업로드
   *  엔드포인트)를 그대로 쓰는 `uploadImage` 커맨드를 직접 실행한다. 서버로
   *  외부 URL 을 재요청(재호스팅)하는 방식은 이전 라운드에서 사이트별로
   *  불안정(CORS 차단·조용한 실패·우클릭 자체 차단)해 전량 롤백했으므로
   *  이번엔 시도하지 않는다 — 바이너리가 없으면 아무 것도 하지 않고 CKEditor5
   *  기본 동작에 맡긴다.
   *
   *  컨테이너 셀렉터(`scanEditors`)가 이미 댓글 에디터(`g7ce-wrapper`)를
   *  구조적으로 배제하므로 게시글 본문 편집기에만 적용된다(별도 스코프 코드 불요).
   */

  var pasteImageRoots = []; // [{ domRoot, editor }]
  var pasteImageListenerBound = false;

  /** 클립보드 아이템에서 이미지 파일 바이너리만 추출한다 (없으면 빈 배열). */
  function extractClipboardImageFiles(clipboardData) {
    var files = [];
    if (!clipboardData || !clipboardData.items) return files;
    for (var i = 0; i < clipboardData.items.length; i++) {
      var item = clipboardData.items[i];
      if (item && item.kind === 'file' && item.type && item.type.indexOf('image/') === 0) {
        var f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    return files;
  }

  /**
   * sirsoft-ckeditor5 관리자 설정에 실제 저장된 업로드 최대 크기(MB)를 읽는다.
   * 서버 검증(`ImageUploadRequest`)이 이 값을 그대로 쓰므로, 클라이언트 사전
   * 차단 기준도 임의 숫자가 아니라 이 값을 그대로 따른다.
   */
  function getCkeditor5MaxUploadMb() {
    try {
      var gs = window.G7Core.state.get();
      var settings = (gs._global && gs._global.plugins && gs._global.plugins['sirsoft-ckeditor5'])
        || (gs.plugins && gs.plugins['sirsoft-ckeditor5']);
      var n = parseInt(settings && settings.imageMaxSizeMb, 10);
      return n > 0 ? n : null;
    } catch (e) {
      return null;
    }
  }

  /** 붙여넣은 파일들을 기존 로컬 이미지 업로드 경로(uploadImage 커맨드)로 넘긴다.
   * 서버 크기 제한을 이미 넘는 파일은 업로드를 아예 시도하지 않고 즉시 안내한다
   * (사후 타임아웃보다 나은 사용자 경험 — 불필요한 대기 자체를 없앤다).
   */
  function uploadPastedImages(editor, files) {
    var maxMb = getCkeditor5MaxUploadMb();
    var maxBytes = maxMb ? maxMb * 1024 * 1024 : null;
    var accepted = [];
    var rejected = [];
    for (var i = 0; i < files.length; i++) {
      if (maxBytes && files[i].size > maxBytes) rejected.push(files[i]);
      else accepted.push(files[i]);
    }
    if (rejected.length) {
      var msg = t('editor.image.too_large_client_check', '이미지 파일이 너무 큽니다(최대 {max}MB). 더 작은 이미지로 다시 시도해주세요.').replace('{max}', String(maxMb));
      var toast = window.G7Core && window.G7Core.toast;
      if (toast && typeof toast.warning === 'function') toast.warning(msg);
      else { try { window.alert(msg); } catch (e) {} }
    }
    if (!accepted.length) return;
    try {
      editor.execute('uploadImage', { file: accepted });
    } catch (e) {
      try { console.warn('[g7-ckeditor5-superpack] 클립보드 이미지 업로드 실행 실패:', e); } catch (e2) {}
    }
  }

  /** document 캡처 단계 paste 리스너를 1회만 등록한다. */
  function ensurePasteImageListener() {
    if (pasteImageListenerBound || typeof document === 'undefined') return;
    pasteImageListenerBound = true;
    document.addEventListener('paste', function (evt) {
      for (var i = 0; i < pasteImageRoots.length; i++) {
        var entry = pasteImageRoots[i];
        if (!entry.domRoot || !entry.domRoot.isConnected || !entry.domRoot.contains(evt.target)) continue;

        var cd = evt.clipboardData || (evt.originalEvent && evt.originalEvent.clipboardData);
        var files = extractClipboardImageFiles(cd);
        if (!files.length) return; // 바이너리 없음 → CKEditor5 기본 동작에 맡김

        evt.preventDefault();
        evt.stopPropagation();
        if (evt.stopImmediatePropagation) evt.stopImmediatePropagation();
        uploadPastedImages(entry.editor, files);
        return;
      }
    }, true);
  }

  /** 편집기 컨테이너 하나를 클립보드 이미지 붙여넣기 대상으로 등록한다 (중복 방지).
   * "이미지 복붙" 탭의 imagepaste_enabled 설정이 꺼져 있으면 등록 자체를 하지 않는다 —
   * pasteImageRoots 에 아무 것도 안 쌓이므로 document 캡처 리스너(ensurePasteImageListener)
   * 도 필요 없어져 결과적으로 이 플러그인의 클립보드 가로채기가 전부 비활성화되고
   * sirsoft-ckeditor5 기본 동작(스크린샷 붙여넣기는 계속 되지만 제출 방지 가드는 빠짐,
   * attachSubmitButtonUploadState/attachUploadTimeoutGuard 도 이 함수 안에서만 걸리므로
   * 같이 꺼진다)으로 돌아간다. */
  function attachPasteImageHandlerTo(container) {
    if (container.__ck5spPasteImage) return;
    var cfg = readSettings();
    if (!cfg.imagePasteEnabled) return;
    var editor = editorInstanceNear(container);
    if (!editor) return;
    var domRoot;
    try { domRoot = editor.editing.view.getDomRoot(); } catch (e) { return; }
    if (!domRoot) return;
    container.__ck5spPasteImage = true;
    pasteImageRoots.push({ domRoot: domRoot, editor: editor });
    ensurePasteImageListener();
    attachSubmitButtonUploadState(editor, domRoot);
    attachUploadTimeoutGuard(editor);
  }

  /* ================================================================ *
   *  이미지 업로드 완료 전 "글 작성 완료" 제출 방지
   * ================================================================ *
   *  실측 확인(재현): 이미지 붙여넣기(클립보드 파일이든 스크린샷이든 동일) 직후
   *  CKEditor5 는 모델에 `<img>` 를 즉시 넣지만 `src` 는 업로드가 끝나기 전까지
   *  아예 비워둔다(`ImageUploadEditing._uploadImage` — 벤더 소스 확인). 업로드가
   *  끝나기 전에 "글 작성 완료" 를 누르면 `editor.getData()` 가 그 순간의 상태
   *  그대로 `<img>`(src 속성 자체가 없음)를 돌려주고, 이 사이트의 게시글 폼은
   *  그 값을 그대로 저장한다 — 검증 결과 DB 에 `<figure class="image"><img></figure>`
   *  로 영구 저장되어 이미지 자리가 완전히 빈칸으로 남는다(재현 성공, 게시글 id
   *  38 로 실측). CKEditor5 는 이 상황을 위해 표준 `PendingActions` 플러그인을
   *  이미 제공한다(`FileRepository` 가 `requires` 로 자동 로드 — 별도 플러그인
   *  등록 불필요, 실측으로 `editor.plugins.get('PendingActions').hasAny` 가
   *  업로드 중 `true` 로 바뀌는 것 확인). 문제는 sirsoft-board 의 게시글 폼이
   *  이 표준 신호를 전혀 확인하지 않는다는 것(코드 전수 검색 결과 0건) — 그래서
   *  여기서 "글 작성 완료" 버튼 클릭을 캡처 단계에서 먼저 가로채, 등록된 에디터
   *  중 하나라도 업로드가 진행 중이면 표준 `PendingActions.hasAny` 를 근거로
   *  제출 자체를 막는다. sirsoft-board/sirsoft-basic 폼 정의(JSON)는 수정하지
   *  않는다(무변경 원칙) — 이 감시도 다른 슈퍼팩 기능과 동일하게 전역 스크립트의
   *  캡처 리스너로만 구현한다. 스크린샷 붙여넣기도 동일한 업로드 파이프라인을
   *  타므로 이 가드가 자동으로 함께 보호한다(신규 클립보드 붙여넣기 기능만의
   *  문제가 아니라 sirsoft-ckeditor5 의 기존 구조적 공백이었음).
   */

  var submitGuardBound = false;

  /** 폼 안에 등록된 에디터 중 업로드가 진행 중인 PendingActions 를 찾는다. */
  function findPendingUploadIn(form) {
    for (var i = 0; i < pasteImageRoots.length; i++) {
      var entry = pasteImageRoots[i];
      if (!entry.domRoot || !form.contains(entry.domRoot)) continue;
      try {
        var pa = entry.editor.plugins.get('PendingActions');
        if (pa && pa.hasAny) return pa;
      } catch (e) {}
    }
    return null;
  }

  /** document 캡처 단계에서 게시글 폼의 제출 버튼 클릭을 감시한다 (1회만 등록). */
  function ensureSubmitGuardListener() {
    if (submitGuardBound || typeof document === 'undefined') return;
    submitGuardBound = true;
    document.addEventListener('click', function (evt) {
      var btn = evt.target && evt.target.closest ? evt.target.closest('button') : null;
      if (!btn) return;
      var form = btn.closest('#form');
      if (!form) return;
      // 게시글 폼(#form) 안의 마지막 버튼 = "등록"/"저장" 버튼 (실측 확인 —
      // 취소·카테고리·에디터 툴바 버튼 등은 전부 그 앞에 렌더링됨).
      var formButtons = form.querySelectorAll('button');
      if (!formButtons.length || formButtons[formButtons.length - 1] !== btn) return;

      var pending = findPendingUploadIn(form);
      if (!pending) return; // 업로드 중인 게 없으면 그냥 통과 (정상 제출)

      evt.preventDefault();
      evt.stopPropagation();
      if (evt.stopImmediatePropagation) evt.stopImmediatePropagation();

      var msg = t('editor.image.upload_pending_submit_blocked', '이미지 업로드가 끝날 때까지 잠시만 기다려주세요. 업로드가 끝나면 다시 눌러주세요.');
      var toast = window.G7Core && window.G7Core.toast;
      if (toast && typeof toast.warning === 'function') toast.warning(msg);
      else { try { window.alert(msg); } catch (e) {} }
    }, true);
  }

  /* ================================================================ *
   *  등록 버튼 "업로드중" 상태 전환 (위 제출 차단의 1차 방어로 승격)
   * ================================================================ *
   *  위 캡처+토스트 가드는 이제 "혹시 몰라 남겨두는" 이중 안전장치일 뿐이고,
   *  주된 방어는 이 섹션 — 업로드 중에는 버튼 자체를 "업로드중"으로 바꾸고
   *  비활성화해 클릭이 애초에 발생하지 않게 한다(정상 흐름에서는 위 토스트가
   *  뜰 일이 없다 — 버튼이 이미 막혀 있으므로).
   *
   *  여러 이미지가 동시에 업로드 중이어도 표준 `PendingActions.hasAny` 를
   *  그대로 신뢰한다 — `FileRepository` 는 `loaders` 컬렉션 길이가 0 으로
   *  돌아올 때만(즉 모든 로더가 끝났을 때만) pending action 을 제거하므로,
   *  "먼저 끝난 이미지 때문에 버튼이 풀리는" 경우는 표준 동작상 발생하지
   *  않는다(벤더 소스 `_updatePendingAction` 확인 — 별도 카운터 불필요).
   */

  /** 폼(#form) 안에서 제출 버튼(마지막 버튼)을 찾는다. 없으면 null. */
  function findFormSubmitButton(domRoot) {
    var form = domRoot && domRoot.closest ? domRoot.closest('#form') : null;
    if (!form) return null;
    var btns = form.querySelectorAll('button');
    return btns.length ? btns[btns.length - 1] : null;
  }

  /** 버튼 안의 문구 텍스트 노드를 담은 요소를 찾는다(아이콘과 분리된 span 우선). */
  function findButtonLabelNode(btn) {
    return btn.querySelector('span') || btn;
  }

  /** 제출 버튼을 PendingActions.hasAny 에 묶어 "업로드중" 상태를 전환한다 (편집기당 1회). */
  function attachSubmitButtonUploadState(editor, domRoot) {
    var btn = findFormSubmitButton(domRoot);
    if (!btn || btn.__ck5spUploadStateBound) return;
    btn.__ck5spUploadStateBound = true;

    var pendingActions;
    try { pendingActions = editor.plugins.get('PendingActions'); } catch (e) { return; }
    if (!pendingActions) return;

    var labelNode = null;
    var originalLabel = null; // null = 현재 "업로드중" 상태가 아님 (하드코딩 금지 — 실제 버튼 원문을 저장/복원)

    pendingActions.on('change:hasAny', function (evt, name, value) {
      if (value) {
        if (originalLabel === null) {
          labelNode = findButtonLabelNode(btn);
          originalLabel = labelNode.textContent;
        }
        labelNode.textContent = t('editor.image.uploading_button_label', '업로드중');
        btn.disabled = true;
      } else if (originalLabel !== null) {
        labelNode.textContent = originalLabel;
        btn.disabled = false;
        originalLabel = null;
      }
    });
  }

  /* ================================================================ *
   *  업로드 멈춤(영구 pending) 안전장치 — 강제 타임아웃
   * ================================================================ *
   *  실측 확인: 3.7MB~8MB대 이미지를 실제로 붙여넣으면 서버 크기 제한
   *  (`imageMaxSizeMb`, 이 사이트는 50MB로 충분히 여유 — 크기 제한에 걸린
   *  게 아님)에는 안 걸리는데도 업로드가 끝나지도 실패하지도 않고 무한정
   *  멈춘다. 원인을 추적한 결과 — php-fpm 워커는 전부 idle(sleeping) 상태로
   *  실제 처리 중이 아니었고, Laravel 로그에도 해당 요청이 전혀 기록되지
   *  않았으며, Cloudflare Tunnel(cloudflared) 로그에 해당 업로드 요청마다
   *  `"Incoming request ended abruptly: context canceled"` 가 정확히 대응되는
   *  것을 확인했다 — 즉 서버(PHP)가 멈춘 게 아니라 **클라이언트→오리진 전송이
   *  중간에 끊기고, XHR 이 그 상태에서 load/error 이벤트를 받지 못해 영원히
   *  대기하는 것**이 근본 원인으로 보인다(정확한 원인 계층 — 터널/네트워크
   *  구간의 문제로 추정 — 은 이 플러그인의 코드 범위 밖이라 이번엔 근본
   *  차단 대신 클라이언트 타임아웃으로 사용자를 무한 대기에서 반드시
   *  풀어주는 안전장치를 넣는다).
   *
   *  `FileRepository.loaders` 컬렉션 레벨에서 건다 — 이 컬렉션은 트리거가
   *  클립보드 붙여넣기든 스크린샷 붙여넣기든 에디터의 다른 업로드 경로든
   *  전부 공유하므로, 이 안전장치는 자동으로 모든 업로드 경로에 공통 적용된다.
   *
   *  **실측으로 드러난 추가 함정**: 벤더 `Loader.abort()`는 상태를 `aborted`로
   *  바꾸고 어댑터의 `xhr.abort()`를 호출할 뿐 — 실제 정리(모델에서 이미지
   *  제거, `FileRepository.loaders`에서 제거, `PendingActions` 해제)는 그
   *  `xhr`가 비동기로 발화하는 네이티브 `abort` 이벤트를 CKEditor5 내부
   *  `ImageUploadEditing._readAndUpload`의 프라미스 체인이 받아야만 일어난다.
   *  이 사이트의 실제 정체 상황(업로드 바디는 100% 전송 완료됐지만 서버
   *  응답이 영영 안 오는 상태 — Cloudflare Tunnel 쪽 절단으로 추정)에서는
   *  **`xhr.abort()`를 호출해도 그 네이티브 `abort` 이벤트가 발화하지 않는
   *  것을 직접 재현·확인했다**(`loader.abort()`를 수동 호출한 뒤 여러 초를
   *  기다려도 `loaders.length`가 줄지 않고 `PendingActions.hasAny`도 계속
   *  `true`로 남음). 그래서 이 타임아웃 가드는 `loader.abort()` 호출에만
   *  기대지 않고, 그 비동기 콜백이 안 와도 사용자가 절대 갇히지 않도록
   *  **모델의 이미지 요소 제거 + `FileRepository.destroyLoader()` 호출을
   *  우리가 직접, 그 자리에서 수행**한다(둘 다 CKEditor5가 공개하는 표준
   *  API — 내부 전용 메서드를 억지로 파고든 게 아니다).
   */

  /** 업로드 하나가 이 시간(ms) 안에 끝나지 않으면 강제로 정리한다.
   * 서버 fastcgi_read_timeout(600s)보다 훨씬 짧게 잡아, 사용자가 실제로
   * 체감하기 전에 안내와 함께 풀어준다. */
  var UPLOAD_STUCK_TIMEOUT_MS = 45000;

  /** 모델에서 이 uploadId 를 가진 이미지 요소를 찾아 제거한다(있으면). */
  function removeStuckUploadImageElement(editor, uploadId) {
    var root = editor.model.document.getRoot();
    var target = null;
    for (var value of editor.model.createRangeIn(root)) {
      var item = value.item;
      if (item.getAttribute && item.getAttribute('uploadId') === uploadId) {
        target = item;
        break;
      }
    }
    if (target) {
      editor.model.change(function (writer) { writer.remove(target); });
    }
  }

  /** 편집기 하나의 FileRepository 에 강제 타임아웃 가드를 붙인다(편집기당 1회). */
  function attachUploadTimeoutGuard(editor) {
    if (editor.__ck5spUploadTimeoutGuard) return;
    editor.__ck5spUploadTimeoutGuard = true;

    var fileRepo;
    try { fileRepo = editor.plugins.get('FileRepository'); } catch (e) { return; }
    if (!fileRepo) return;

    fileRepo.loaders.on('add', function (evt, loader) {
      var settled = false;

      var timer = window.setTimeout(function () {
        if (settled) return;
        settled = true;

        try { loader.abort(); } catch (e) {}
        // xhr.abort() 의 비동기 콜백을 기다리지 않고 즉시 직접 정리한다
        // (위 주석 — 이 환경에서 그 콜백이 오지 않는 경우를 실측 확인).
        try { removeStuckUploadImageElement(editor, loader.id); } catch (e) {}
        try { fileRepo.destroyLoader(loader); } catch (e) {}

        var msg = t('editor.image.upload_timeout', '이미지 업로드가 너무 오래 걸려 취소되었습니다. 파일 크기나 네트워크 상태를 확인한 뒤 다시 시도해주세요.');
        var toast = window.G7Core && window.G7Core.toast;
        if (toast && typeof toast.error === 'function') toast.error(msg);
        else { try { window.alert(msg); } catch (e2) {} }
      }, UPLOAD_STUCK_TIMEOUT_MS);

      function onRemoved(evt2, removedItem) {
        if (removedItem !== loader) return;
        settled = true;
        window.clearTimeout(timer);
        fileRepo.loaders.off('remove', onRemoved);
      }
      fileRepo.loaders.on('remove', onRemoved);
    });
  }

  /* ================================================================ *
   *  에디터 스타일 — 본문 기본 글자크기·줄간격 (전역, 기본은 댓글 제외)
   * ================================================================ *
   *  - **게시글 본문(방문자 화면)**: `.ck-content.prose` — sirsoft-board 의
   *    `html_content` 확장 포인트가 붙이는 클래스 조합.
   *  - **댓글(방문자 화면)**: 댓글은 `.ck-content`/`prose` 경로를 전혀 타지 않는다
   *    (재조사 확인).
   *    sirsoft-board 코어 댓글 API 에는 `content_mode` 필드가 없어 댓글 본문은 항상
   *    `<p class="text-gray-700 dark:text-gray-300">…</p>` 로 text 바인딩(HTML
   *    이스케이프) 렌더링된다. 실제로 굵게·목록·표 등 서식이 보이는 것은
   *    g7-comment-editor 의 `upgradeRenderedComments()` 가 전역에서
   *    `p.text-gray-700` + `dark:text-gray-300` 조합을 스캔해 새니타이즈된 HTML 로
   *    `innerHTML` 승격시키는, sirsoft-board 렌더링과는 완전히 별개인 후처리
   *    경로 때문이다(승격 후에도 클래스는 그대로 `text-gray-700 dark:text-gray-300`
   *    이며 `ck-content`/`prose` 계열 클래스는 붙지 않음, 실브라우저 DOM 확인).
   *    따라서 `editor_apply_to_comments` 설정이 켜지면 g7-comment-editor 자신이
   *    승격 대상 판별에 쓰는 것과 동일한 조합인 `p.text-gray-700.dark\:text-gray-300`
   *    셀렉터를 규칙에 추가한다 — CSS는 DOM 클래스 기준으로 적용되므로 그 클래스를
   *    어느 플러그인이 렌더링/승격했는지는 무관하다(슈퍼팩·g7-comment-editor 어느
   *    쪽 파일도 건드리지 않음).
   *  - **편집 화면**: 표식은 CKEditor 가 관리하지 않는 **바깥 컨테이너**에 붙이고,
   *    CSS 는 그 아래 `.ck-editor__editable` 에 건다. 편집 루트(`getDomRoot()`)에
   *    직접 붙이면 CKEditor 렌더러가 포커스 전환 때 루트 class 를 다시 써서 표식이
   *    지워진다(1.5.0 에서 고침).
   *    - 게시글 본문 에디터: `div.ckeditor5-wrapper` (sirsoft-ckeditor5
   *      `html-editor.json` 의 고정 className 컨테이너, 편집기는 그 안에 생성)
   *    - 댓글 에디터: `div.g7ce-wrapper` (g7-comment-editor 가 만드는 컨테이너).
   *      "댓글에도 적용" 옵션이 켜져 있을 때만 붙인다.
   *    컨테이너는 안에 `.ck-editor__editable` 이 있을 때만 대상이다.
   *
   * font-size/line-height 는 `ckeditor5.css`에 `.ck-content` 베이스 규칙이 아예
   * 없어(조사 확인) 경합 대상 자체가 없지만, 로드 순서가 결정론적이지 않은 동적
   * 주입 CSS(둘 다 런타임에 <head>/DOM 에 붙음)라는 특성상 `!important`로 안전하게
   * 고정한다.
   */

  var EDITOR_STYLE_ID = 'ck5sp-editor-style';
  var EDITOR_STYLE_MARKER = 'ck5sp-body-editor-style';
  var COMMENT_EDITOR_STYLE_MARKER = 'ck5sp-comment-editor-style';

  /**
   * 에디터 제목(CKEditor 기본 heading 옵션: 제목 1·2·3 = h2·h3·h4)의 크기·줄간격·여백·굵기.
   * 템플릿 Tailwind Preflight 가 h1~h6 를 `font-size/font-weight: inherit` 로 리셋해 제목이
   * 본문 크기로 보이므로 여기서 준다. em 은 본문 글자 크기(글자 크기) / 그 제목 자신의 크기(여백) 기준.
   * `!important` 는 쓰지 않는다 — 사용자가 인라인 style 로 준 크기가 이기게 한다.
   * 마크다운 변환 제목(`[data-ck5-md]`)은 자기 규칙(10 조각)이 있으므로 제외한다.
   */
  var EDITOR_HEADINGS = [
    ['h2', '1.5em', '1.2em', '.6em'],
    ['h3', '1.3em', '1.1em', '.5em'],
    ['h4', '1.15em', '1em', '.5em']
  ];

  function editorHeadingCss(scopes) {
    return EDITOR_HEADINGS.map(function (h) {
      var sel = scopes.map(function (s) { return s + ' ' + h[0] + ':not([data-ck5-md])'; }).join(',');
      return sel + '{font-size:' + h[1] + ';line-height:1.4;margin-top:' + h[2] + ';margin-bottom:' + h[3] + ';font-weight:700;}';
    }).join('');
  }

  /** 관리자 설정값으로 <style> 태그를 생성/갱신/제거한다(멱등). */
  function injectEditorStyleCss(cfg) {
    var existing = document.getElementById(EDITOR_STYLE_ID);
    if (!cfg.editorStyleEnabled) {
      if (existing) existing.remove();
      return;
    }
    var selectors = ['.ck-content.prose'];
    if (cfg.editorApplyToComments) selectors.push('p.text-gray-700.dark\\:text-gray-300');
    var editorScopes = ['.' + EDITOR_STYLE_MARKER + ' .ck-editor__editable', '.' + COMMENT_EDITOR_STYLE_MARKER + ' .ck-editor__editable'];
    var rule = 'font-size:' + cfg.editorFontSize + 'px!important;line-height:' + cfg.editorLineHeight + '!important;';
    var css = selectors.join(',') + '{' + rule + '}'
      + editorScopes.join(',') + '{' + rule + '}'
      + editorHeadingCss(selectors.concat(editorScopes));
    if (existing) {
      if (existing.textContent !== css) existing.textContent = css;
      return;
    }
    var el = document.createElement('style');
    el.id = EDITOR_STYLE_ID;
    el.textContent = css;
    document.head.appendChild(el);
  }

  /** 편집기 바깥 컨테이너에 표식 클래스를 붙이거나 뗀다(안에 편집 영역이 있을 때만 붙임). */
  function markEditorContainers(selector, marker, enabled) {
    var list = document.querySelectorAll(selector);
    for (var i = 0; i < list.length; i++) {
      var want = enabled && !!list[i].querySelector('.ck-editor__editable');
      if (list[i].classList.contains(marker) !== want) list[i].classList.toggle(marker, want);
    }
  }

  /** 본문 에디터·댓글 에디터 컨테이너의 표식을 설정에 맞춘다(멱등). */
  function applyEditorStyleMarkers() {
    var cfg = readSettings();
    var on = !!cfg.editorStyleEnabled;
    markEditorContainers('div.ckeditor5-wrapper', EDITOR_STYLE_MARKER, on);
    markEditorContainers('div.g7ce-wrapper', COMMENT_EDITOR_STYLE_MARKER, on && !!cfg.editorApplyToComments);
  }

  function scanEditors() {
    // 동영상 업로드 바/이미지 복붙 둘 다 켜짐 여부를 각자 내부에서
    // 확인하므로(attachUploaderTo, attachPasteImageHandlerTo) 여기선 컨테이너 존재만
    // 확인한다. (이전엔 `if (!cfg.videoEnabled) return;` 로 videoEnabled 가
    // 꺼지면 이 순회 자체를 건너뛰었는데, 그러면 videoEnabled 와 무관한 다른
    // 기능까지 함께 막히므로 제거했다 — 각 attach 함수가 자기 설정을 스스로
    // 확인하는 현재 구조가 버그 없이 이미 검증됨, 원복하지 않고 유지)
    var containers = document.querySelectorAll('.ckeditor5-wrapper, [id^="ckeditor5-"]');
    for (var i = 0; i < containers.length; i++) {
      // 에디터가 실제로 붙었는지 확인 (editable 존재)
      var cont = containers[i];
      if (!editorInstanceNear(cont)) continue;
      attachUploaderTo(cont);
      attachPasteImageHandlerTo(cont);
      ensureSubmitGuardListener();
    }
    // 편집 스타일 표식은 위 컨테이너 목록과 무관하게 고정 구조로 찾는다.
    applyEditorStyleMarkers();
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

  /* ================================================================ *
   *  마크다운 문법 → 서식 (렌더 시점 변환)
   * ================================================================ */

  var MD_STYLE_ID = 'ck5-md-style';

  function injectMarkdownStyle() {
    if (document.getElementById(MD_STYLE_ID)) return;
    var el = document.createElement('style');
    el.id = MD_STYLE_ID;
    /* 방문자 화면(HtmlContent)은 Tailwind Preflight 가 h1~h6 를 font-size/weight:inherit 로,
       ul/ol 를 list-style:none;padding:0 으로 리셋한다. 이 사이트엔 @tailwindcss/typography
       (`prose`) base 가 로드돼 있지 않아 `prose-h3:text-lg` 같은 유틸도 무효 → 우리가 만든
       <h3>/<ul> 등이 본문 텍스트와 똑같이 보인다. blockquote/code 처럼 생성 요소를 직접 스타일한다.
       (레이어 없는 <style> 이라 @layer base 인 Preflight 보다 캐스케이드 우선.) */
    el.textContent = ''
      + '.ck-content [data-ck5-md] code, .ck-content code[data-ck5-mdc]{background:#f1f5f9;border-radius:4px;padding:.1em .35em;font-size:.9em;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;}'
      + 'html.dark .ck-content [data-ck5-md] code, html.dark .ck-content code[data-ck5-mdc]{background:#334155;}'
      + '.ck-content pre.ck5-md-pre{background:#0f172a;color:#e2e8f0;border-radius:8px;padding:12px 14px;overflow:auto;font-size:.85em;line-height:1.5;white-space:pre;}'
      + '.ck-content pre.ck5-md-pre code{background:transparent;padding:0;color:inherit;}'
      + '.ck-content blockquote[data-ck5-md]{border-left:3px solid #cbd5e1;padding-left:.9em;color:#475569;margin:.8em 0;}'
      + 'html.dark .ck-content blockquote[data-ck5-md]{border-color:#475569;color:#94a3b8;}'
      + '.ck-content h1[data-ck5-md]{font-size:1.8em;font-weight:700;line-height:1.25;margin:.9em 0 .45em;}'
      + '.ck-content h2[data-ck5-md]{font-size:1.5em;font-weight:700;line-height:1.3;margin:.85em 0 .4em;}'
      + '.ck-content h3[data-ck5-md]{font-size:1.25em;font-weight:700;line-height:1.35;margin:.75em 0 .35em;}'
      + '.ck-content ul[data-ck5-md]{list-style:disc outside;padding-left:1.7em;margin:.6em 0;}'
      + '.ck-content ol[data-ck5-md]{list-style:decimal outside;padding-left:1.9em;margin:.6em 0;}'
      + '.ck-content ul[data-ck5-md]>li, .ck-content ol[data-ck5-md]>li{display:list-item;margin:.2em 0;}'
      + '.ck-content [data-ck5-md-inline] strong, .ck-content [data-ck5-md] strong{font-weight:700;}'
      + '.ck-content [data-ck5-md-inline] em, .ck-content [data-ck5-md] em{font-style:italic;}'
      + '.ck-content a[data-ck5-mda]{color:#2563eb;text-decoration:underline;}'
      + 'html.dark .ck-content a[data-ck5-mda]{color:#60a5fa;}'
      /* 표·구분선: CKEditor 5 content styles(표/HorizontalLine) 값에 맞춤. 열이 많은 표는 가로 스크롤. */
      + '.ck-content figure.table[data-ck5-md]{display:block;overflow-x:auto;margin:.9em 0;}'
      + '.ck-content figure.table[data-ck5-md]>table{border-collapse:collapse;border-spacing:0;width:100%;border:1px double #b3b3b3;}'
      + '.ck-content figure.table[data-ck5-md] th, .ck-content figure.table[data-ck5-md] td{min-width:2em;padding:.4em;border:1px solid #bfbfbf;text-align:left;vertical-align:top;}'
      + '.ck-content figure.table[data-ck5-md] th{font-weight:700;background:rgba(0,0,0,.05);}'
      + 'html.dark .ck-content figure.table[data-ck5-md]>table, html.dark .ck-content figure.table[data-ck5-md] th, html.dark .ck-content figure.table[data-ck5-md] td{border-color:#475569;}'
      + 'html.dark .ck-content figure.table[data-ck5-md] th{background:rgba(255,255,255,.06);}'
      + '.ck-content hr[data-ck5-md]{margin:15px 0;height:4px;background:#dedede;border:0;}'
      + 'html.dark .ck-content hr[data-ck5-md]{background:#475569;}';
    document.head.appendChild(el);
  }

  function mdEsc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /** 한 텍스트 조각에 인라인 마크다운 적용 → HTML 문자열 (입력은 먼저 escape). */
  function mdInline(str, cfg) {
    var out = mdEsc(str);
    var stash = [];
    var keep = function (html) { stash.push(html); return '\u0001' + (stash.length - 1) + '\u0001'; };
    if (cfg.mdCode) {
      out = out.replace(/`([^`\n]+?)`/g, function (_, c) { return keep('<code data-ck5-mdc="1">' + c + '</code>'); });
    }
    if (cfg.mdLink) {
      out = out.replace(/\[([^\]\n]{1,200}?)\]\((https?:\/\/[^\s)]{1,500}?)\)/g, function (_, t, u) {
        return keep('<a data-ck5-mda="1" href="' + u.replace(/"/g, '%22') + '" target="_blank" rel="noopener noreferrer">' + t + '</a>');
      });
    }
    if (cfg.mdBold) {
      out = out.replace(/\*\*([^\s*][^*\n]*?[^\s*]|[^\s*])\*\*/g, '<strong>$1</strong>');
    }
    if (cfg.mdItalic) {
      out = out.replace(/(^|[^*\w])\*([^\s*][^*\n]*?[^\s*]|[^\s*])\*(?!\*)/g, '$1<em>$2</em>');
    }
    out = out.replace(/\u0001(\d+)\u0001/g, function (_, i) { return stash[+i]; });
    return out;
  }

  /** el 의 텍스트 노드들에 인라인 마크다운 적용 (사용자가 이미 서식 준 요소는 스킵). */
  function mdApplyInline(el, cfg) {
    if (!el || el.dataset.ck5MdInline === '1') return;
    if (el.querySelector('a, strong, b, em, i, code, s, u, mark, sub, sup')) { el.dataset.ck5MdInline = '1'; return; }
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    var textNodes = [], n;
    while ((n = walker.nextNode())) {
      if (n.parentElement && n.parentElement.closest('code, pre, a')) continue;
      textNodes.push(n);
    }
    textNodes.forEach(function (tn) {
      var raw = tn.nodeValue;
      if (!/[*`[]/.test(raw)) return;
      var html = mdInline(raw, cfg);
      if (html === mdEsc(raw)) return;
      try {
        var frag = document.createRange().createContextualFragment(html);
        tn.parentNode.replaceChild(frag, tn);
      } catch (e) {}
    });
    el.dataset.ck5MdInline = '1';
  }

  /** 구분선 줄: 같은 기호 3개 이상만(`---`, `***`, `___`), 공백·다른 문자 섞이면 아님. */
  var MD_HR_RE = /^(?:-{3,}|\*{3,}|_{3,})$/;
  /** GFM 표 구분 행: `|---|:---:|` 형태, 파이프 필수(파이프 없는 `---` 는 구분선). 정렬 표기는 무시. */
  var MD_TABLE_DELIM_RE = /^\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?$/;

  /** 표 한 행 → 셀 문자열 배열 (양끝 파이프 제거, `\|` 는 셀 안의 문자 `|`). */
  function mdTableCells(line) {
    var s = line.trim();
    if (s.charAt(0) === '|') s = s.slice(1);
    if (s.slice(-1) === '|' && s.slice(-2) !== '\\|') s = s.slice(0, -1);
    var cells = [], buf = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (ch === '\\' && s.charAt(i + 1) === '|') { buf += '|'; i++; }
      else if (ch === '|') { cells.push(buf.trim()); buf = ''; }
      else buf += ch;
    }
    cells.push(buf.trim());
    return cells;
  }

  /** header 줄 + 다음 줄이 GFM 표 시작(헤더·구분 행 열 수 일치)이면 열 수, 아니면 0. */
  function mdTableCols(header, delim) {
    if (!header || !delim || header.indexOf('|') < 0 || delim.indexOf('|') < 0) return 0;
    if (!MD_TABLE_DELIM_RE.test(delim)) return 0;
    var n = mdTableCells(header).length;
    return n === mdTableCells(delim).length ? n : 0;
  }

  /**
   * `.ck-content` 안의 마크다운 문법을 실제 서식으로 바꾼다 (방문자 화면 전용 — 편집기
   * editable 에서는 실행 안 함). 다른 승격 패스보다 먼저 돌아 링크가 `<a>` 가 된 뒤
   * SNS/OG 카드 로직이 걸리게 한다.
   *
   * 오탐 방지: 블록 변환은 **줄 전체가 문법에 정확히 맞고**(공백 필수), 그 `<p>` 에 자식
   * 엘리먼트가 없을 때만. 목록·순서목록은 **2줄 이상 연속**일 때만(단일 "- 문장" 무시).
   * 기울임(`*x*`)은 기본 꺼짐. 사용자가 에디터 버튼으로 서식을 준 문단은 인라인 변환 스킵.
   */
  function renderMarkdown(scope, cfg) {
    if (scope.closest('.ck-editor__editable, .ck-editor')) return; // 편집 중에는 변환 안 함

    // 블록 패스 + 인라인 패스 모두 멱등(변환 요소에 data-ck5-md* 마커). 스캔마다 다시 돌아도
    // 이미 변환된 건 건너뛰므로, 콘텐츠가 뒤늦게/다시 렌더돼도 스스로 따라잡는다.
    {
      injectMarkdownStyle();

      // Pasted markdown is often stored by CKEditor as <p>line1<br>line2<br>line3</p>
      // (soft breaks). The block logic below assumes one line per <p>, so split any
      // text-plus-<br>-only <p> that contains at least one block-markdown line into
      // one <p> per <br> segment. Non-markdown multi-line paragraphs are left alone.
      var BLOCK_MD_RE = /^(?:#{1,3}[ \t]|[-*+][ \t]|\d{1,3}\.[ \t]|>[ \t]?|```)/;
      var splitTargets = [];
      for (var si = 0; si < scope.children.length; si++) {
        var sc = scope.children[si];
        if (sc.dataset && sc.dataset.ck5Md) continue;
        if (!/^(P|DIV)$/.test(sc.tagName)) continue;
        if (sc.closest('.ck5-video, .' + EMBED_WRAPPER_CLASS + ', .ck5-linkcard, pre')) continue;
        if (!sc.querySelector('br')) continue;
        var onlyTextAndBr = true;
        for (var cn = sc.firstChild; cn; cn = cn.nextSibling) {
          if (cn.nodeType === 1 && cn.tagName !== 'BR') { onlyTextAndBr = false; break; }
        }
        if (onlyTextAndBr) splitTargets.push(sc);
      }
      splitTargets.forEach(function (pEl) {
        var segs = [], buf = '';
        for (var n = pEl.firstChild; n; n = n.nextSibling) {
          if (n.nodeType === 1 && n.tagName === 'BR') { segs.push(buf); buf = ''; }
          else if (n.nodeType === 3) buf += n.nodeValue;
        }
        segs.push(buf);
        var anyMd = segs.some(function (s) { return BLOCK_MD_RE.test((s || '').replace(/ /g, ' ').trim()); });
        if (!anyMd && (cfg.mdTable || cfg.mdHr)) {
          var tl = segs.map(function (s) { return (s || '').replace(/ /g, ' ').trim(); });
          anyMd = tl.some(function (s, ti) {
            return (cfg.mdHr && MD_HR_RE.test(s)) || (cfg.mdTable && mdTableCols(s, tl[ti + 1]) > 0);
          });
        }
        if (!anyMd) return;
        var frag = document.createDocumentFragment();
        segs.forEach(function (s) {
          var np = document.createElement('p');
          if ((s || '').replace(/ /g, ' ').trim() === '') np.appendChild(document.createElement('br'));
          else np.textContent = s;
          frag.appendChild(np);
        });
        pEl.replaceWith(frag);
      });

      var kids = [];
      for (var i = 0; i < scope.children.length; i++) {
        var k = scope.children[i];
        // 이미 변환된 블록(제목·목록·인용·코드·표·구분선)은 재스캔 때도 kids 에 "경계"로 남긴다.
        // 빠지면 그 앞뒤 줄이 연속으로 보여, 페이지의 반복 스캔에서 `- a` / `# 제목` / `- b` 가
        // 한 목록으로 합쳐지고 제목 뒤로 밀린다. 경계는 pure() 가 false 라 어떤 변환 대상도 아니다.
        if (k.dataset && k.dataset.ck5Md) { kids.push(k); continue; }
        if (/^(P|DIV)$/.test(k.tagName) && !k.closest('.ck5-video, .' + EMBED_WRAPPER_CLASS + ', .ck5-linkcard, pre')) kids.push(k);
      }
      var lineOf = function (el) {
        if (el.querySelector('br')) return null; // residual <br> <p> (not a split target) -> hold off block convert
        return (el.textContent || '').replace(/ /g, ' ').trim();
      };
      var pure = function (el) { return !(el.dataset && el.dataset.ck5Md) && !el.querySelector('*'); };
      var mergeList = function (kids, start, re, strip, tag) {
        var run = [start], j = start + 1;
        while (j < kids.length) {
          var l = lineOf(kids[j]);
          if (l && re.test(l) && pure(kids[j])) { run.push(j); j++; } else break;
        }
        if (run.length < 2) return -1;
        var list = document.createElement(tag);
        list.dataset.ck5Md = '1';
        run.forEach(function (ri) {
          var li = document.createElement('li');
          li.textContent = lineOf(kids[ri]).replace(strip, '');
          list.appendChild(li);
        });
        kids[run[0]].replaceWith(list);
        for (var d = run.length - 1; d >= 1; d--) kids[run[d]].remove();
        return run[run.length - 1];
      };

      var p = 0;
      while (p < kids.length) {
        var el = kids[p];
        var line = lineOf(el);
        if (line === null || line === '' || !pure(el)) { p++; continue; }

        var hm = cfg.mdHeading && line.match(/^(#{1,3})[ \t]+(\S.*)$/);
        if (hm) {
          var h = document.createElement('h' + hm[1].length);
          h.textContent = hm[2];
          h.dataset.ck5Md = '1';
          el.replaceWith(h); kids[p] = h; p++; continue;
        }
        if (cfg.mdList && /^[-*+][ \t]+\S/.test(line)) {
          var e1 = mergeList(kids, p, /^[-*+][ \t]+\S/, /^[-*+][ \t]+/, 'ul');
          if (e1 >= 0) { p = e1 + 1; continue; }
        }
        if (cfg.mdList && /^\d{1,3}\.[ \t]+\S/.test(line)) {
          var e2 = mergeList(kids, p, /^\d{1,3}\.[ \t]+\S/, /^\d{1,3}\.[ \t]+/, 'ol');
          if (e2 >= 0) { p = e2 + 1; continue; }
        }
        if (cfg.mdQuote && /^>[ \t]?/.test(line)) {
          var qrun = [p], qj = p + 1;
          while (qj < kids.length) {
            var q2 = lineOf(kids[qj]);
            if (q2 !== null && /^>[ \t]?/.test(q2) && pure(kids[qj])) { qrun.push(qj); qj++; } else break;
          }
          var bq = document.createElement('blockquote');
          bq.dataset.ck5Md = '1';
          qrun.forEach(function (ri, idx) {
            if (idx) bq.appendChild(document.createElement('br'));
            bq.appendChild(document.createTextNode(lineOf(kids[ri]).replace(/^>[ \t]?/, '')));
          });
          kids[qrun[0]].replaceWith(bq);
          for (var d3 = qrun.length - 1; d3 >= 1; d3--) kids[qrun[d3]].remove();
          p = qrun[qrun.length - 1] + 1; continue;
        }
        if (cfg.mdCode && /^```/.test(line)) {
          var end = -1;
          for (var f = p + 1; f < kids.length; f++) {
            var fl = lineOf(kids[f]);
            if (fl !== null && /^```\s*$/.test(fl) && !kids[f].dataset.ck5Md) { end = f; break; }
          }
          if (end > p) {
            var pre = document.createElement('pre');
            pre.className = 'ck5-md-pre'; pre.dataset.ck5Md = '1';
            var code = document.createElement('code');
            var lines = [];
            for (var g = p + 1; g < end; g++) lines.push(kids[g].textContent || '');
            code.textContent = lines.join('\n');
            pre.appendChild(code);
            kids[p].replaceWith(pre);
            for (var d4 = end; d4 >= p + 1; d4--) kids[d4].remove();
            p = end + 1; continue;
          }
        }
        // 표·구분선은 기존 요소 판정이 모두 빗나간 줄에만 적용(기존 변환 결과 불변).
        if (cfg.mdTable && p + 1 < kids.length && pure(kids[p + 1])) {
          var cols = mdTableCols(line, lineOf(kids[p + 1]));
          if (cols > 0) {
            var rowEnd = p + 2;
            while (rowEnd < kids.length) {
              var rl = lineOf(kids[rowEnd]);
              if (rl && rl.indexOf('|') >= 0 && pure(kids[rowEnd])) rowEnd++; else break;
            }
            var fig = document.createElement('figure');
            fig.className = 'table';
            fig.dataset.ck5Md = '1';
            var tbl = document.createElement('table');
            var addRow = function (parent, text, cellTag) {
              var tr = document.createElement('tr');
              var cells = mdTableCells(text);
              for (var ci = 0; ci < cols; ci++) {
                var cell = document.createElement(cellTag);
                cell.innerHTML = mdInline(ci < cells.length ? cells[ci] : '', cfg);
                cell.dataset.ck5MdInline = '1';
                tr.appendChild(cell);
              }
              parent.appendChild(tr);
            };
            var thead = document.createElement('thead');
            addRow(thead, line, 'th');
            tbl.appendChild(thead);
            if (rowEnd > p + 2) {
              var tbody = document.createElement('tbody');
              for (var r = p + 2; r < rowEnd; r++) addRow(tbody, lineOf(kids[r]), 'td');
              tbl.appendChild(tbody);
            }
            fig.appendChild(tbl);
            kids[p].replaceWith(fig);
            for (var d5 = rowEnd - 1; d5 >= p + 1; d5--) kids[d5].remove();
            kids.splice(p, rowEnd - p, fig);
            p++; continue;
          }
        }
        if (cfg.mdHr && MD_HR_RE.test(line)) {
          // 방문자 화면 전용 렌더라 에디터의 HorizontalLine 로드 여부와 무관하게 <hr>.
          // 토글이 꺼져 있으면 건드리지 않아 원문 글자(`---`) 그대로 보인다.
          var hrEl = document.createElement('hr');
          hrEl.dataset.ck5Md = '1';
          el.replaceWith(hrEl); kids[p] = hrEl; p++; continue;
        }
        p++;
      }
    }

    // 인라인 패스
    var inlineEls = scope.querySelectorAll('p, h1, h2, h3, li, blockquote');
    for (var m = 0; m < inlineEls.length; m++) {
      var ie = inlineEls[m];
      if (ie.closest('.ck5-video, .' + EMBED_WRAPPER_CLASS + ', .ck5-linkcard, pre')) continue;
      mdApplyInline(ie, cfg);
    }
  }

  /* ================================================================ *
   *  통합 스캔
   * ================================================================ */

  function scan(root) {
    root = root || document;
    var cfg = readSettings();
    if (!cfg.snsEnabled && !cfg.linkcardEnabled && !cfg.videoEnabled && !cfg.mdEnabled) return;

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

      /* ---- -1) 마크다운 문법 → 실제 서식 (다른 모든 패스보다 먼저) ---- */
      // 링크가 실제 <a> 가 된 다음에 SNS/OG 카드 승격이 걸리도록 순서상 맨 앞.
      if (cfg.mdEnabled) renderMarkdown(scope, cfg);

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
      [2000, 5000, 10000].forEach(function (ms) { window.setTimeout(reprocessPresent, ms); });
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

  // 코어 ActionDispatcher 가 있으면 수동 트리거용 핸들러도 등록 (레이아웃 onMount 등에서 호출 가능)
  function registerHandlers(retry) {
    var dispatcher = window.G7Core && window.G7Core.getActionDispatcher && window.G7Core.getActionDispatcher();
    if (dispatcher) {
      dispatcher.registerHandler(IDENTIFIER + '.render', function () { scan(document); }, { category: 'plugin', source: IDENTIFIER });
      return;
    }
    if (!retry) return;
    var tries = 0;
    var timer = window.setInterval(function () {
      var d = window.G7Core && window.G7Core.getActionDispatcher && window.G7Core.getActionDispatcher();
      if (d) {
        d.registerHandler(IDENTIFIER + '.render', function () { scan(document); }, { category: 'plugin', source: IDENTIFIER });
        window.clearInterval(timer);
      } else if (++tries >= 50) {
        window.clearInterval(timer);
      }
    }, 100);
  }

  function init() {
    registerHandlers(true);
    run();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  window.__G7Ckeditor5Superpack = { rescan: function () { scan(document); } };
})();
