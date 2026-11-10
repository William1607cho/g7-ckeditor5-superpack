/**
 * g7-ckeditor5-superpack — 글 보기 묶음 (1.7.0, 지연 로드: dist/js/view.js)
 *
 * 관리자 설정 "글 보기" 탭의 기능(목차·이미지 확대 보기·접기/펼치기·읽는 시간) 중 하나라도 켜져 있고,
 * 화면에 글 본문이 있을 때만 전역 스크립트(07-chunks)가 이 파일을 불러온다.
 * 대상은 글 상세 화면의 글 본문 하나뿐이다(`core.findMainBody()` — 표식 `data-g7-post-body` 우선, 없으면 추정).
 * 페이지·답글 원글 상자·약관 모달·댓글·편집 영역은 대상이 아니다.
 *
 * 조각 구성은 전역 스크립트와 같다(`00` 열기 · `10~79` 기능 · `99` 닫기, scripts/build-js.sh 가 이어 붙임).
 * 기능 조각은 `(function (core) { … })(core);` 로 감싸고 끝에서 `core.section({ load: 'chunk', … })` 로 등록한다.
 */
(function () {
  'use strict';

  var api = window.__G7Ckeditor5Superpack;
  if (!api || typeof api.chunk !== 'function') return;

  api.chunk('view', function (core) {
  /* ================================================================ *
   *  B4 읽는 시간 (1.7.0)
   * ================================================================ *
   *  글 본문 첫머리에 "약 N분" 한 줄. 계산(순수 함수 `core.ns('readtime')`):
   *   한글·한자·가나 글자 수 ÷ 500자/분 + 라틴 단어 수 ÷ 200단어/분 + 이미지 1장 6초(최대 60초).
   *   코드 블록(`pre`)·이 묶음이 넣은 요소의 글자는 세지 않는다. 1분 미만은 "1분"으로 올린다.
   *   글자도 이미지도 없으면 표시하지 않는다.
   */
  (function (core) {
    'use strict';

    var CJK_RE = /[ᄀ-ᇿ㄰-㆏가-힯぀-ヿ㐀-䶿一-鿿豈-﫿]/g;
    var WORD_RE = /[A-Za-z0-9À-ɏ]+(?:['’][A-Za-z]+)*/g;
    var CJK_PER_MIN = 500;
    var WORDS_PER_MIN = 200;
    var SEC_PER_IMAGE = 6;
    var MAX_IMAGE_SEC = 60;
    var STYLE_ID = 'ck5sp-readtime-style';
    // 세지 않는 자리: 코드, 이 묶음이 넣은 요소, 임베드·카드·동영상의 버튼 글자
    var SKIP_SEL = 'pre, [data-ck5sp-view], .ck5-media-embed__foot, .ck5-video__foot, .ck5-linkcard__domain';

    /** 글자에서 한글·한자·가나 글자 수와 라틴 단어 수를 센다. */
    function countText(text) {
      var s = String(text == null ? '' : text);
      var cjk = (s.match(CJK_RE) || []).length;
      var words = (s.replace(CJK_RE, ' ').match(WORD_RE) || []).length;
      return { cjk: cjk, words: words };
    }

    /** 분 단위 읽는 시간(올림, 최소 1). 읽을 것이 없으면 0. */
    function estimateMinutes(counts, images) {
      var cjk = Math.max(0, counts.cjk | 0);
      var words = Math.max(0, counts.words | 0);
      var imgs = Math.max(0, images | 0);
      if (cjk === 0 && words === 0 && imgs === 0) return 0;
      var sec = cjk / CJK_PER_MIN * 60 + words / WORDS_PER_MIN * 60 + Math.min(imgs * SEC_PER_IMAGE, MAX_IMAGE_SEC);
      return Math.max(1, Math.ceil(sec / 60));
    }

    function label(minutes) {
      return core.t('content.readtime.minutes', '약 {n}분').replace('{n}', String(minutes));
    }

    var ns = core.ns('readtime');
    ns.countText = countText;
    ns.estimateMinutes = estimateMinutes;
    ns.label = label;

    /** 본문에서 셀 글자(건너뛸 자리 제외)를 모은다. */
    function bodyText(body) {
      var out = [];
      var walker = document.createTreeWalker(body, 4 /* SHOW_TEXT */, null);
      var n;
      while ((n = walker.nextNode())) {
        var p = n.parentElement;
        if (p && p.closest && p.closest(SKIP_SEL)) continue;
        out.push(n.nodeValue);
      }
      return out.join(' ');
    }

    function bodyImages(body) {
      var imgs = body.querySelectorAll('img');
      var c = 0;
      for (var i = 0; i < imgs.length; i++) {
        if (imgs[i].closest('.ck5-linkcard, .ck5-media-embed, [data-ck5sp-view]')) continue;
        c++;
      }
      return c;
    }

    function injectStyle() {
      if (document.getElementById(STYLE_ID)) return;
      var el = document.createElement('style');
      el.id = STYLE_ID;
      el.textContent = ''
        + '.ck-content .ck5sp-readtime{margin:0 0 .9em!important;font-size:.8125rem;line-height:1.4;color:#6b7280;}'
        + 'html.dark .ck-content .ck5sp-readtime{color:#9ca3af;}';
      document.head.appendChild(el);
    }

    function readTimeEnd() {
      var body = core.findMainBody();
      if (!body || body.querySelector('[data-ck5sp-view="readtime"]')) return;
      var minutes = estimateMinutes(countText(bodyText(body)), bodyImages(body));
      if (!minutes) return;
      injectStyle();
      var line = document.createElement('p');
      line.className = 'ck5sp-readtime';
      line.setAttribute('data-ck5sp-view', 'readtime');
      line.textContent = label(minutes);
      body.insertBefore(line, body.firstChild);
    }

    core.section({
      name: 'view-readtime',
      scope: 'visitor',
      order: 110,
      load: 'chunk',
      gate: function (cfg) { return cfg.viewReadTime; },
      enabled: function (cfg) { return cfg.viewReadTime; },
      styles: [STYLE_ID],
      visitorEnd: readTimeEnd
    });
  })(core);

  /* ================================================================ *
   *  B1 목차 (1.7.0)
   * ================================================================ *
   *  글 본문의 제목(툴바 제목 h2~h4, 마크다운 제목 h1~h3)이 MIN_HEADINGS 개 이상이면 본문 첫머리
   *  (읽는 시간 줄 다음)에 접을 수 있는 목차를 넣는다. 저장 데이터는 바꾸지 않고 화면에서만 제목에 id 를 준다.
   *  - 수준은 글 안에서 쓰인 것끼리 상대 단계로 맞춘다(가장 높은 수준 = 1단계, 최대 3단계).
   *  - id: 제목에 이미 id 가 있고 문서에서 하나뿐이면 그대로, 아니면 `ck5-toc-<순번>`.
   *  - 누르면 그 제목으로 부드럽게 이동하고 주소의 #만 바꾼다(history.replaceState — 화면 이동 없음).
   *    접힌 상자(B3) 안의 제목이면 먼저 연다. 주소에 #ck5-toc-n 이 있으면 목차를 만든 직후 한 번 이동한다.
   *  - 좁은 화면(640px 미만)에서는 접힌 채로 시작한다.
   */
  (function (core) {
    'use strict';

    var MIN_HEADINGS = 3;
    var MAX_DEPTH = 3;
    var STYLE_ID = 'ck5sp-toc-style';
    var HEADING_SEL = 'h1, h2, h3, h4';
    var SKIP_SEL = '[data-ck5sp-view], .ck5-linkcard, .ck5-media-embed, pre';
    var hashDone = {}; // 이미 한 번 이동한 #id

    /**
     * 제목 목록으로 목차 모델을 만든다(순수 함수).
     * @param {Array<{level:number,text:string,id:string}>} heads  문서 순서의 제목
     * @param {function(string):boolean} idTaken  문서에 그 id 가 이미 (다른 요소에) 있으면 true
     * @return {Array<{depth:number,text:string,id:string,keepId:boolean}>|null}  MIN_HEADINGS 미만이면 null
     */
    function tocModel(heads, idTaken) {
      var list = [];
      for (var i = 0; i < heads.length; i++) {
        var text = String(heads[i].text || '').replace(/\s+/g, ' ').trim();
        if (text) list.push({ level: heads[i].level | 0, text: text, id: String(heads[i].id || '') });
      }
      if (list.length < MIN_HEADINGS) return null;
      var levels = [];
      list.forEach(function (h) { if (levels.indexOf(h.level) === -1) levels.push(h.level); });
      levels.sort(function (a, b) { return a - b; });
      var used = {};
      var out = [];
      for (var j = 0; j < list.length; j++) {
        var h = list[j];
        var depth = Math.min(levels.indexOf(h.level), MAX_DEPTH - 1);
        var keep = /^[A-Za-z][\w:.-]*$/.test(h.id) && !used[h.id] && !(idTaken && idTaken(h.id));
        var id = keep ? h.id : 'ck5-toc-' + (j + 1);
        while (used[id] || (!keep && idTaken && idTaken(id))) id = id + '-x';
        used[id] = true;
        out.push({ depth: depth, text: h.text, id: id, keepId: keep });
      }
      return out;
    }

    core.ns('toc').model = tocModel;
    core.ns('toc').MIN_HEADINGS = MIN_HEADINGS;

    function injectStyle() {
      if (document.getElementById(STYLE_ID)) return;
      var el = document.createElement('style');
      el.id = STYLE_ID;
      el.textContent = ''
        + '.ck-content .ck5sp-toc{margin:0 0 1.4em!important;padding:.7em 1em;border:1px solid #e5e7eb;border-radius:10px;background:#f9fafb;font-size:.9rem;line-height:1.5;}'
        + '.ck5sp-toc__head{display:flex;align-items:center;gap:.4em;width:100%;padding:0;margin:0;border:0;background:none;font:inherit;font-weight:600;color:#374151;cursor:pointer;text-align:left;}'
        + '.ck5sp-toc__head::after{content:"";margin-left:auto;width:.5em;height:.5em;border-right:2px solid currentColor;border-bottom:2px solid currentColor;transform:rotate(45deg);transition:transform .15s;}'
        + '.ck5sp-toc__head[aria-expanded="false"]::after{transform:rotate(-45deg);}'
        + '.ck5sp-toc__head:focus-visible{outline:2px solid #60a5fa;outline-offset:2px;border-radius:4px;}'
        + '.ck-content .ck5sp-toc__list{list-style:none!important;margin:.5em 0 0!important;padding:0!important;}'
        + '.ck5sp-toc__head[aria-expanded="false"]+.ck5sp-toc__list{display:none;}'
        + '.ck-content .ck5sp-toc__list li{margin:.15em 0!important;padding:0!important;}'
        + '.ck-content .ck5sp-toc__list li::before{content:none!important;}'
        + '.ck5sp-toc__list li[data-depth="1"]{padding-left:1.1em!important;}'
        + '.ck5sp-toc__list li[data-depth="2"]{padding-left:2.2em!important;font-size:.95em;}'
        + '.ck-content .ck5sp-toc__list a{color:#2563eb;text-decoration:none;}'
        + '.ck-content .ck5sp-toc__list a:hover{text-decoration:underline;}'
        + '.ck-content [data-ck5sp-toc-target]{scroll-margin-top:5rem;}'
        + 'html.dark .ck-content .ck5sp-toc{background:#1f2937;border-color:#374151;}'
        + 'html.dark .ck5sp-toc__head{color:#e5e7eb;}'
        + 'html.dark .ck-content .ck5sp-toc__list a{color:#60a5fa;}'
        + '@media print{.ck-content .ck5sp-toc{display:none;}}';
      document.head.appendChild(el);
    }

    function goTo(target, smooth) {
      try { core.ns('fold').revealFor && core.ns('fold').revealFor(target); } catch (e) {}
      try { target.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' }); } catch (e) { target.scrollIntoView(); }
    }

    function buildNav(model) {
      var nav = document.createElement('nav');
      nav.className = 'ck5sp-toc';
      nav.setAttribute('data-ck5sp-view', 'toc');
      var title = core.t('content.toc.title', '목차');
      nav.setAttribute('aria-label', title);
      var listId = 'ck5sp-toc-list-' + Math.floor(Math.random() * 1e9);
      var narrow = !!(window.matchMedia && window.matchMedia('(max-width: 639px)').matches);
      var html = '<button type="button" class="ck5sp-toc__head" aria-expanded="' + (narrow ? 'false' : 'true') + '" aria-controls="' + listId + '">'
        + core.esc(title) + '</button><ol class="ck5sp-toc__list" id="' + listId + '">';
      for (var i = 0; i < model.length; i++) {
        html += '<li data-depth="' + model[i].depth + '"><a href="#' + core.esc(model[i].id) + '" data-ck5sp-toc-link="' + core.esc(model[i].id) + '">'
          + core.esc(model[i].text) + '</a></li>';
      }
      nav.innerHTML = html + '</ol>';
      nav.addEventListener('click', function (evt) {
        var head = evt.target.closest('.ck5sp-toc__head');
        if (head) {
          head.setAttribute('aria-expanded', head.getAttribute('aria-expanded') === 'true' ? 'false' : 'true');
          return;
        }
        var a = evt.target.closest('[data-ck5sp-toc-link]');
        if (!a || evt.ctrlKey || evt.metaKey || evt.shiftKey || evt.button) return;
        var target = document.getElementById(a.getAttribute('data-ck5sp-toc-link'));
        if (!target) return;
        evt.preventDefault();
        goTo(target, true);
        try { window.history.replaceState(window.history.state, '', '#' + target.id); } catch (e) {}
      });
      return nav;
    }

    function tocEnd() {
      var body = core.findMainBody();
      if (!body || body.querySelector('[data-ck5sp-view="toc"]')) return;
      var nodes = body.querySelectorAll(HEADING_SEL);
      var els = [];
      var heads = [];
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].closest(SKIP_SEL)) continue;
        els.push(nodes[i]);
        heads.push({ level: parseInt(nodes[i].tagName.slice(1), 10), text: nodes[i].textContent, id: nodes[i].id });
      }
      var model = tocModel(heads, function (id) {
        var found = document.getElementById(id);
        return !!found && els.indexOf(found) === -1;
      });
      if (!model) return;
      // 빈 제목은 모델에서 빠지므로 글자 있는 제목만 짝짓는다
      var withText = els.filter(function (e) { return String(e.textContent || '').trim() !== ''; });
      for (var j = 0; j < model.length && j < withText.length; j++) {
        if (!model[j].keepId) withText[j].id = model[j].id;
        withText[j].setAttribute('data-ck5sp-toc-target', '');
      }
      injectStyle();
      var nav = buildNav(model);
      var rt = body.querySelector(':scope > [data-ck5sp-view="readtime"]');
      body.insertBefore(nav, rt ? rt.nextSibling : body.firstChild);

      var hash = decodeURIComponent((window.location.hash || '').slice(1));
      if (hash && !hashDone[hash]) {
        for (var k = 0; k < model.length; k++) {
          if (model[k].id !== hash) continue;
          hashDone[hash] = true;
          var t = document.getElementById(hash);
          if (t) goTo(t, false);
          break;
        }
      }
    }

    core.section({
      name: 'view-toc',
      scope: 'visitor',
      order: 120,
      load: 'chunk',
      gate: function (cfg) { return cfg.viewToc; },
      enabled: function (cfg) { return cfg.viewToc; },
      styles: [STYLE_ID],
      visitorEnd: tocEnd
    });
  })(core);

  });
})();
