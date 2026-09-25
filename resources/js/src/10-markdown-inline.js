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
      out = out.replace(/\[([^\]\n]{1,200}?)\]\((https?:\/\/[^\s)]{1,500}?)\)/g, function (_, label, u) {
        return keep('<a data-ck5-mda="1" href="' + u.replace(/"/g, '%22') + '" target="_blank" rel="noopener noreferrer">' + label + '</a>');
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

