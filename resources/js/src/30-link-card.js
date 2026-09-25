  /* ================================================================ *
   *  링크 카드
   * ================================================================ */

  var API = '/api/plugins/' + IDENTIFIER + '/link-preview';
  var LINKCARD_STYLE_ID = 'ck5-linkcard-style';
  var MAX_INFLIGHT = 3;

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
      ? '<div class="ck5-linkcard__favwrap"><img class="ck5-linkcard__favicon" src="' + esc(fav) + '" alt="" referrerpolicy="no-referrer" width="18" height="18"></div>'
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
      // 파비콘 칸은 CSS 로 숨겨 두고 불러오기에 성공했을 때만 보인다. 실패하면 숨긴 채로 둔다(카드 모양 불변).
      var showFav = function () {
        var w = favEl.closest('.ck5-linkcard__favwrap');
        if (w && favEl.naturalWidth > 0) w.classList.add('is-loaded');
      };
      if (favEl.complete) showFav();
      else favEl.addEventListener('load', showFav, { once: true });
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
      + '.ck5-linkcard .ck5-linkcard__favwrap:not(.is-loaded){display:none;}'
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

  /** 방문자 패스: 단독 일반 링크와 임베드 패스의 미지원 폴백 래퍼를 링크 카드로 바꾼다(SNS 패스 뒤). */
  function linkCardVisitor(scope, cfg, ctx) {
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
      ctx.once('card', function () { injectLinkCardStyle(cfg); });
      cardTargets.forEach(function (tt) {
        getPreview(tt.url).then(function (p) {
          if (!tt.replace.isConnected) return;
          applyCard(tt.replace, tt.url, p, tt.kind, cfg);
        });
      });
    }
  }

  core.section({
    name: 'link-card',
    scope: 'visitor',
    order: 50,
    load: 'eager',
    gate: function (cfg) { return cfg.linkcardEnabled; },
    enabled: function (cfg) { return cfg.linkcardEnabled; },
    styles: [LINKCARD_STYLE_ID],
    visitor: linkCardVisitor
  });

