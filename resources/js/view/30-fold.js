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

