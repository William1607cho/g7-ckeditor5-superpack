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

