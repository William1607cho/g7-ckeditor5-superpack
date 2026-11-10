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

  });
})();
