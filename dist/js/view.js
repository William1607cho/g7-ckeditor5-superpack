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

  /* ================================================================ *
   *  B3 접기/펼치기 (1.7.0)
   * ================================================================ *
   *  글 본문의 바로 아래 블록 중 글자 전체가 `[접기] 제목` 인 블록부터 `[/접기]` 인 블록까지를
   *  접힌 상자로 바꾼다. 저장 데이터는 그대로이고, 봇 화면·목록 요약에는 표식 글자가 그대로 보인다.
   *  - 표식은 각각 한 줄(한 문단)이어야 한다. 닫는 줄이 없는 여는 줄, 짝 없는 닫는 줄은 글자 그대로 둔다.
   *  - 겹쳐 쓰기(안에 또 접기)는 하지 않는다: 열린 상자 안의 `[접기]` 는 글자로 남는다.
   *  - 화면에 만드는 것은 `details` 가 아니라 버튼(aria-expanded) + 영역(hidden)이다(템플릿 정제 규칙의 취지).
   *  - 숨은 영역 안의 임베드·동영상은 펼칠 때 공용 관찰자가 연결한다(지연 연결 그대로).
   *  - `core.ns('fold').revealFor(el)`: el 이 접힌 상자 안이면 연다(목차가 쓴다).
   */
  (function (core) {
    'use strict';

    var STYLE_ID = 'ck5sp-fold-style';
    var OPEN_RE = /^\[접기\](?:\s+([\s\S]*))?$/;
    var CLOSE_RE = /^\[\/접기\]$/;
    var BLOCK_TAGS = { P: 1, DIV: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1 };
    var seq = 0;

    /** 블록 글자 하나를 표식으로 해석한다(순수). */
    function parseMarker(text) {
      var s = String(text == null ? '' : text).replace(/[ ​]/g, ' ').replace(/\s+/g, ' ').trim();
      if (CLOSE_RE.test(s)) return { type: 'close' };
      var m = s.match(OPEN_RE);
      if (m) return { type: 'open', title: (m[1] || '').trim() };
      return null;
    }

    /**
     * 표식 종류 목록(문서 순서)에서 짝을 찾는다(순수). 겹치지 않고, 닫히지 않은 여는 줄은 버린다.
     * @param {Array<string|null>} kinds  'open' | 'close' | null
     * @return {Array<[number, number]>}  [여는 줄 번호, 닫는 줄 번호]
     */
    function pairMarkers(kinds) {
      var pairs = [];
      var openAt = -1;
      for (var i = 0; i < kinds.length; i++) {
        if (kinds[i] === 'open' && openAt === -1) openAt = i;
        else if (kinds[i] === 'close' && openAt !== -1) { pairs.push([openAt, i]); openAt = -1; }
      }
      return pairs;
    }

    var ns = core.ns('fold');
    ns.parseMarker = parseMarker;
    ns.pairMarkers = pairMarkers;

    function setOpen(box, open) {
      var head = box.querySelector(':scope > .ck5sp-fold__head');
      var panel = box.querySelector(':scope > .ck5sp-fold__body');
      if (!head || !panel) return;
      head.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) panel.removeAttribute('hidden');
      else panel.setAttribute('hidden', '');
    }

    ns.revealFor = function (el) {
      var box = el && el.closest ? el.closest('.ck5sp-fold') : null;
      while (box) {
        setOpen(box, true);
        box = box.parentElement ? box.parentElement.closest('.ck5sp-fold') : null;
      }
    };

    function injectStyle() {
      if (document.getElementById(STYLE_ID)) return;
      var el = document.createElement('style');
      el.id = STYLE_ID;
      el.textContent = ''
        + '.ck-content .ck5sp-fold{margin:1em 0!important;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;}'
        + '.ck5sp-fold__head{display:flex;align-items:center;gap:.5em;width:100%;margin:0;padding:.65em 1em;border:0;background:#f9fafb;font:inherit;font-weight:600;color:#1f2937;text-align:left;cursor:pointer;}'
        + '.ck5sp-fold__head::before{content:"";flex:0 0 auto;width:.45em;height:.45em;border-right:2px solid currentColor;border-bottom:2px solid currentColor;transform:rotate(-45deg);transition:transform .15s;}'
        + '.ck5sp-fold__head[aria-expanded="true"]::before{transform:rotate(45deg);}'
        + '.ck5sp-fold__head:hover{background:#f3f4f6;}'
        + '.ck5sp-fold__head:focus-visible{outline:2px solid #60a5fa;outline-offset:-2px;}'
        + '.ck5sp-fold__body{padding:.2em 1em .6em;}'
        + '.ck5sp-fold__body[hidden]{display:none!important;}'
        + 'html.dark .ck-content .ck5sp-fold{border-color:#374151;}'
        + 'html.dark .ck5sp-fold__head{background:#1f2937;color:#f3f4f6;}'
        + 'html.dark .ck5sp-fold__head:hover{background:#273244;}'
        + '@media print{.ck5sp-fold__body[hidden]{display:block!important;}}';
      document.head.appendChild(el);
    }

    var clickBound = false;
    function bindClick() {
      if (clickBound) return;
      clickBound = true;
      document.addEventListener('click', function (evt) {
        var head = evt.target && evt.target.closest ? evt.target.closest('.ck5sp-fold__head') : null;
        if (!head) return;
        var box = head.parentElement;
        if (!box || !box.classList.contains('ck5sp-fold')) return;
        setOpen(box, head.getAttribute('aria-expanded') !== 'true');
      });
    }

    function foldEnd() {
      var body = core.findMainBody();
      if (!body) return;
      var blocks = [];
      var kinds = [];
      var parsed = [];
      for (var c = body.firstElementChild; c; c = c.nextElementSibling) {
        var k = null;
        var p = null;
        // 글자만 있는 블록(자식 요소가 br 뿐)만 표식이 될 수 있다
        if (BLOCK_TAGS[c.tagName] && !c.querySelector(':scope > :not(br)')) {
          p = parseMarker(c.textContent);
          k = p ? p.type : null;
        }
        blocks.push(c);
        kinds.push(k);
        parsed.push(p);
      }
      var pairs = pairMarkers(kinds);
      if (!pairs.length) return;
      injectStyle();
      bindClick();
      for (var i = 0; i < pairs.length; i++) {
        var openEl = blocks[pairs[i][0]];
        var closeEl = blocks[pairs[i][1]];
        var title = parsed[pairs[i][0]].title || core.t('content.fold.open', '펼치기');
        var box = document.createElement('div');
        box.className = 'ck5sp-fold';
        box.setAttribute('data-ck5sp-fold', '');
        var id = 'ck5sp-fold-' + (++seq);
        var head = document.createElement('button');
        head.type = 'button';
        head.className = 'ck5sp-fold__head';
        head.setAttribute('aria-expanded', 'false');
        head.setAttribute('aria-controls', id);
        head.textContent = title;
        var panel = document.createElement('div');
        panel.className = 'ck5sp-fold__body';
        panel.id = id;
        panel.setAttribute('hidden', '');
        var n = openEl.nextSibling;
        while (n && n !== closeEl) {
          var next = n.nextSibling;
          panel.appendChild(n);
          n = next;
        }
        box.appendChild(head);
        box.appendChild(panel);
        body.insertBefore(box, openEl);
        openEl.remove();
        closeEl.remove();
      }
    }

    core.section({
      name: 'view-fold',
      scope: 'visitor',
      order: 100,
      load: 'chunk',
      gate: function (cfg) { return cfg.viewFold; },
      enabled: function (cfg) { return cfg.viewFold; },
      styles: [STYLE_ID],
      visitorEnd: foldEnd
    });
  })(core);

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

  });
})();
