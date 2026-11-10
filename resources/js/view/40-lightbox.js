  /* ================================================================ *
   *  B2 이미지 확대 보기(라이트박스) (1.7.0)
   * ================================================================ *
   *  글 본문의 이미지를 누르면 새 탭 대신 화면 위에 크게 보여 주고, 본문의 다른 이미지로 넘긴다.
   *  - 대상: 글 본문(`core.findMainBody()`)의 이미지 중
   *      · g7-image-delivery 가 감싼 원본 링크(`<a href=".../sirsoft-ckeditor5/images/<해시>">`) 안에서
   *        그 링크와 해시가 같은 이미지(변환본 `.../g7-image-delivery/variants/<해시>-…` 포함)
   *      · 링크 밖 이미지(image-delivery 가 꺼져 있을 때)
   *    글쓴이가 다른 주소로 직접 건 링크 이미지, 링크 카드·임베드 썸네일, 댓글 이미지는 대상이 아니다.
   *  - Ctrl/⌘/Shift/가운데 클릭은 그대로(새 탭). 문서 클릭 위임 1개, 오버레이는 body 에 1개만 만든다.
   *  - 키보드 ←/→/Esc, 좌우 밀기, 이웃 1장 미리 불러오기, 포커스 가두기·닫으면 원래 자리로 포커스.
   *  - 보여 줄 주소: srcset 의 가장 큰 후보 → 원본 링크 → 이미지 src. "원본 보기"는 원본 링크(없으면 src).
   */
  (function (core) {
    'use strict';

    var STYLE_ID = 'ck5sp-lightbox-style';
    var ORIGINAL_RE = /\/api\/plugins\/sirsoft-ckeditor5\/images\/([a-f0-9]{12})(?![a-f0-9])/i;
    var VARIANT_RE = /\/api\/plugins\/g7-image-delivery\/variants\/([a-f0-9]{12})-/i;
    var EXCLUDE_SEL = '.ck5-linkcard, .ck5-media-embed, [data-ck5sp-view], .ck5sp-lb';

    /** 에디터 업로드 이미지 해시(원본·변환본 주소 모두) 또는 null (순수) */
    function imageHash(url) {
      var s = String(url || '');
      var m = s.match(ORIGINAL_RE) || s.match(VARIANT_RE);
      return m ? m[1].toLowerCase() : null;
    }

    /** srcset 에서 가장 큰 폭(w) 후보의 주소. 폭 표기가 없으면 마지막 후보. 없으면 null (순수) */
    function largestFromSrcset(srcset) {
      var parts = String(srcset || '').split(',');
      var best = null;
      var bestW = -1;
      for (var i = 0; i < parts.length; i++) {
        var seg = parts[i].trim();
        if (!seg) continue;
        var bits = seg.split(/\s+/);
        var url = bits[0];
        var w = 0;
        var d = bits[1] || '';
        if (/^\d+w$/i.test(d)) w = parseInt(d, 10);
        else if (/^[\d.]+x$/i.test(d)) w = parseFloat(d) * 1000;
        if (w >= bestW) { bestW = w; best = url; }
      }
      return best;
    }

    /**
     * 이미지가 확대 보기 대상인지(순수): 감싼 링크가 없거나, 링크가 그 이미지의 원본 주소일 때만.
     * @param {string|null} linkHref  감싼 a 의 href (없으면 null)
     * @param {string} src  img src
     * @param {string} srcset  img srcset
     */
    function isZoomable(linkHref, src, srcset) {
      if (linkHref === null || linkHref === undefined) return true;
      var lh = imageHash(linkHref);
      if (!lh || !ORIGINAL_RE.test(linkHref)) return false;
      var ih = imageHash(src) || imageHash(largestFromSrcset(srcset));
      return ih === lh;
    }

    var ns = core.ns('lightbox');
    ns.imageHash = imageHash;
    ns.largestFromSrcset = largestFromSrcset;
    ns.isZoomable = isZoomable;

    /* ---- 화면 ---- */

    var box = null;
    var state = { items: [], index: 0, opener: null, prevOverflow: '', touchX: null };

    function injectStyle() {
      if (document.getElementById(STYLE_ID)) return;
      var el = document.createElement('style');
      el.id = STYLE_ID;
      el.textContent = ''
        + '.ck5sp-lb{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.88);outline:none;}'
        + '.ck5sp-lb[hidden]{display:none;}'
        + '.ck5sp-lb__fig{margin:0;max-width:92vw;max-height:88vh;display:flex;flex-direction:column;align-items:center;}'
        + '.ck5sp-lb__img{max-width:92vw;max-height:80vh;object-fit:contain;display:block;background:#111;user-select:none;-webkit-user-drag:none;}'
        + '.ck5sp-lb__cap{margin-top:.5em;color:#e5e7eb;font-size:.875rem;text-align:center;max-width:80vw;}'
        + '.ck5sp-lb__cap:empty{display:none;}'
        + '.ck5sp-lb button{position:absolute;border:0;border-radius:9999px;background:rgba(255,255,255,.14);color:#fff;cursor:pointer;font:600 22px/1 system-ui,sans-serif;width:44px;height:44px;display:flex;align-items:center;justify-content:center;}'
        + '.ck5sp-lb button:hover{background:rgba(255,255,255,.26);}'
        + '.ck5sp-lb button:focus-visible{outline:3px solid #60a5fa;outline-offset:2px;}'
        + '.ck5sp-lb__close{top:14px;right:14px;}'
        + '.ck5sp-lb__prev{left:14px;top:50%;margin-top:-22px;}'
        + '.ck5sp-lb__next{right:14px;top:50%;margin-top:-22px;}'
        + '.ck5sp-lb[data-single] .ck5sp-lb__prev,.ck5sp-lb[data-single] .ck5sp-lb__next,.ck5sp-lb[data-single] .ck5sp-lb__count{display:none;}'
        + '.ck5sp-lb__bar{position:absolute;bottom:14px;left:0;right:0;display:flex;justify-content:center;gap:1.2em;color:#d1d5db;font-size:.8125rem;}'
        + '.ck5sp-lb__orig{color:#d1d5db;text-decoration:underline;}'
        + '@media (max-width:640px){.ck5sp-lb__prev,.ck5sp-lb__next{top:auto;bottom:10px;margin-top:0;}.ck5sp-lb__bar{bottom:24px;}}'
        + '.ck-content a[data-ck5sp-zoom] img,.ck-content img[data-ck5sp-zoom]{cursor:zoom-in;}';
      document.head.appendChild(el);
    }

    function el(tag, cls, attrs) {
      var e = document.createElement(tag);
      if (cls) e.className = cls;
      for (var k in attrs || {}) if (Object.prototype.hasOwnProperty.call(attrs, k)) e.setAttribute(k, attrs[k]);
      return e;
    }

    function ensureBox() {
      if (box && box.isConnected) return box;
      injectStyle();
      box = el('div', 'ck5sp-lb', { role: 'dialog', 'aria-modal': 'true', 'aria-label': core.t('content.lightbox.dialog', '이미지 크게 보기'), tabindex: '-1', hidden: '' });
      var close = el('button', 'ck5sp-lb__close', { type: 'button', 'aria-label': core.t('content.lightbox.close', '닫기') });
      close.textContent = '×';
      var prev = el('button', 'ck5sp-lb__prev', { type: 'button', 'aria-label': core.t('content.lightbox.prev', '이전 이미지') });
      prev.textContent = '‹';
      var next = el('button', 'ck5sp-lb__next', { type: 'button', 'aria-label': core.t('content.lightbox.next', '다음 이미지') });
      next.textContent = '›';
      var fig = el('figure', 'ck5sp-lb__fig');
      var img = el('img', 'ck5sp-lb__img', { alt: '' });
      var cap = el('figcaption', 'ck5sp-lb__cap');
      fig.appendChild(img);
      fig.appendChild(cap);
      var bar = el('div', 'ck5sp-lb__bar');
      var count = el('span', 'ck5sp-lb__count');
      var orig = el('a', 'ck5sp-lb__orig', { target: '_blank', rel: 'noopener' });
      orig.textContent = core.t('content.lightbox.original', '원본 보기');
      bar.appendChild(count);
      bar.appendChild(orig);
      box.appendChild(fig);
      box.appendChild(prev);
      box.appendChild(next);
      box.appendChild(close);
      box.appendChild(bar);

      close.addEventListener('click', closeBox);
      prev.addEventListener('click', function () { show(state.index - 1); });
      next.addEventListener('click', function () { show(state.index + 1); });
      box.addEventListener('click', function (evt) { if (evt.target === box) closeBox(); });
      box.addEventListener('keydown', onKey);
      box.addEventListener('touchstart', function (evt) { state.touchX = evt.touches && evt.touches[0] ? evt.touches[0].clientX : null; }, { passive: true });
      box.addEventListener('touchend', function (evt) {
        if (state.touchX === null || !evt.changedTouches || !evt.changedTouches[0]) return;
        var dx = evt.changedTouches[0].clientX - state.touchX;
        state.touchX = null;
        if (Math.abs(dx) > 50) show(state.index + (dx < 0 ? 1 : -1));
      });
      document.body.appendChild(box);
      return box;
    }

    function onKey(evt) {
      if (evt.key === 'Escape') { evt.preventDefault(); closeBox(); return; }
      if (evt.key === 'ArrowLeft') { evt.preventDefault(); show(state.index - 1); return; }
      if (evt.key === 'ArrowRight') { evt.preventDefault(); show(state.index + 1); return; }
      if (evt.key === 'Tab') {
        var f = Array.prototype.filter.call(box.querySelectorAll('button, a[href]'), function (x) { return x.offsetParent !== null; });
        if (!f.length) return;
        var first = f[0];
        var last = f[f.length - 1];
        if (evt.shiftKey && (document.activeElement === first || document.activeElement === box)) { evt.preventDefault(); last.focus(); }
        else if (!evt.shiftKey && document.activeElement === last) { evt.preventDefault(); first.focus(); }
      }
    }

    function itemFor(img) {
      var a = img.closest('a[href]');
      var srcset = img.getAttribute('srcset') || '';
      var big = largestFromSrcset(srcset);
      var origHref = a ? a.getAttribute('href') : null;
      var fig = img.closest('figure');
      var cap = fig ? fig.querySelector('figcaption') : null;
      return {
        img: img,
        opener: a || img,
        src: big || origHref || img.currentSrc || img.getAttribute('src'),
        original: origHref || img.getAttribute('src'),
        caption: cap ? (cap.textContent || '').trim() : '',
        alt: img.getAttribute('alt') || ''
      };
    }

    function collect(body) {
      var out = [];
      var imgs = body.querySelectorAll('img');
      for (var i = 0; i < imgs.length; i++) {
        var im = imgs[i];
        if (im.closest(EXCLUDE_SEL)) continue;
        var a = im.closest('a[href]');
        if (a && !body.contains(a)) a = null;
        if (!isZoomable(a ? a.getAttribute('href') : null, im.getAttribute('src') || '', im.getAttribute('srcset') || '')) continue;
        out.push(itemFor(im));
      }
      return out;
    }

    function preload(i) {
      var it = state.items[i];
      if (!it || it.preloaded) return;
      it.preloaded = true;
      var im = new Image();
      im.decoding = 'async';
      im.src = it.src;
    }

    function show(i) {
      var n = state.items.length;
      if (!n) return;
      state.index = (i + n) % n;
      var it = state.items[state.index];
      var b = ensureBox();
      var img = b.querySelector('.ck5sp-lb__img');
      img.src = it.src;
      img.alt = it.alt;
      b.querySelector('.ck5sp-lb__cap').textContent = it.caption;
      b.querySelector('.ck5sp-lb__count').textContent = (state.index + 1) + ' / ' + n;
      var orig = b.querySelector('.ck5sp-lb__orig');
      if (it.original) orig.setAttribute('href', it.original);
      else orig.removeAttribute('href');
      if (n > 1) { b.removeAttribute('data-single'); preload(state.index + 1 < n ? state.index + 1 : 0); preload(state.index ? state.index - 1 : n - 1); }
      else b.setAttribute('data-single', '');
    }

    function openAt(items, index, opener) {
      state.items = items;
      state.opener = opener;
      var b = ensureBox();
      show(index);
      if (b.hasAttribute('hidden')) {
        state.prevOverflow = document.documentElement.style.overflow;
        document.documentElement.style.overflow = 'hidden';
        b.removeAttribute('hidden');
      }
      try { b.focus(); } catch (e) {}
    }

    function closeBox() {
      if (!box || box.hasAttribute('hidden')) return;
      box.setAttribute('hidden', '');
      box.querySelector('.ck5sp-lb__img').removeAttribute('src');
      document.documentElement.style.overflow = state.prevOverflow || '';
      var o = state.opener;
      state.items = [];
      state.opener = null;
      if (o && o.isConnected) { try { o.focus(); } catch (e) {} }
    }

    var clickBound = false;
    function bindClick() {
      if (clickBound) return;
      clickBound = true;
      document.addEventListener('click', function (evt) {
        if (evt.defaultPrevented || evt.button || evt.ctrlKey || evt.metaKey || evt.shiftKey || evt.altKey) return;
        var t = evt.target;
        if (!t || !t.closest) return;
        var img = t.tagName === 'IMG' ? t : (t.closest('a[href]') ? t.closest('a[href]').querySelector('img') : null);
        if (!img) return;
        if (!core.readSettings().viewLightbox) return;
        var body = core.findMainBody();
        if (!body || !body.contains(img)) return;
        var items = collect(body);
        for (var i = 0; i < items.length; i++) {
          if (items[i].img !== img) continue;
          evt.preventDefault();
          openAt(items, i, items[i].opener);
          return;
        }
      });
      // 다른 화면으로 옮기면(SPA) 열린 상자를 닫는다 — 본문이 사라지는 변화는 방문자 스캔이 알려 준다
    }

    function lightboxEnd() {
      var body = core.findMainBody();
      bindClick();
      if (box && !box.hasAttribute('hidden') && state.opener && !state.opener.isConnected) closeBox();
      if (!body) return;
      injectStyle();
      var items = collect(body);
      for (var i = 0; i < items.length; i++) items[i].opener.setAttribute('data-ck5sp-zoom', '');
    }

    core.section({
      name: 'view-lightbox',
      scope: 'visitor',
      order: 130,
      load: 'chunk',
      gate: function (cfg) { return cfg.viewLightbox; },
      enabled: function (cfg) { return cfg.viewLightbox; },
      styles: [STYLE_ID],
      visitorEnd: lightboxEnd
    });
  })(core);

