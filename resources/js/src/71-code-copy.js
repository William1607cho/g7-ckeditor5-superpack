  /* ================================================================ *
   *  코드 블록 복사 버튼 — 방문자 본문 (1.5.0)
   * ================================================================ *
   *  - 방문자 본문(`.ck-content`)의 모든 `pre`(툴바 코드 블록·마크다운 ``` 코드 블록) 오른쪽
   *    위에 반투명 복사 버튼을 단다. 인라인 코드에는 달지 않는다. `codeformat_enabled` 와
   *    무관하게 항상 단다(기존 글의 코드 블록도 복사할 수 있어야 함).
   *  - 편집 영역(`.ck-editor__editable` 도 `.ck-content`)·댓글 편집기는 제외한다. 버튼이
   *    편집 모델에 섞여 저장되면 안 되기 때문이다.
   *  - 별도 감시기·타이머 없이 기존 `scan()` 경로에서 부른다. 이미 버튼이 있는 `pre` 는
   *    건너뛰므로 반복 호출해도 같다. 기존 노드를 옮기거나 감싸지 않고 버튼만 `pre` 첫
   *    자식으로 넣는다.
   *  - `position: sticky` 는 `pre` 콘텐츠 상자를 벗어나지 못해 가로 스크롤 시 밀려난다.
   *    그래서 절대 위치 + `pre` 의 scroll 이벤트에서 `translateX(scrollLeft)` 로 되돌린다.
   */

  var CODE_COPY_STYLE_ID = 'ck5sp-code-copy-style';
  var CODE_COPY_DONE_MS = 1500;
  var codeCopyWarned = false;

  var COPY_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'
    + '<rect x="9" y="9" width="12" height="12" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
  var CHECK_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'
    + '<polyline points="20 6 9 17 4 12"></polyline></svg>';

  function codeCopyWarn(reason) {
    if (codeCopyWarned) return;
    codeCopyWarned = true;
    try { console.warn('[' + IDENTIFIER + '] code copy failed: ' + (reason && reason.message ? reason.message : reason)); } catch (e) {}
  }

  /** 언어 파일에 키가 없으면 문서 언어(ko 여부)로 대체 문구를 고른다. */
  function codeCopyLabel(done) {
    var lang = (document.documentElement.getAttribute('lang') || '').toLowerCase();
    var ko = lang.indexOf('ko') === 0;
    return done
      ? t('content.code_copy.done', ko ? '복사됨' : 'Copied')
      : t('content.code_copy.label', ko ? '코드 복사' : 'Copy code');
  }

  function injectCodeCopyStyle() {
    if (document.getElementById(CODE_COPY_STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = CODE_COPY_STYLE_ID;
    s.textContent = [
      // 첫 줄 위를 버튼 전용 띠로 비운다(원래 위 여백 + 36px). 화면만 바뀌고 저장·복사 텍스트에는 빈 줄이 없다.
      // 원래 위 여백: 툴바·마크다운 코드 블록 모두 .8em(70, 1.6.0 에서 마크다운도 툴바 모양).
      '.ck-content pre[data-ck5sp-copy]{position:relative;}',
      '.ck-content pre[data-ck5sp-copy][data-ck5sp-copy]:not(.ck5-md-pre){padding-top:calc(.8em + 36px);}',
      '.ck-content pre.ck5-md-pre[data-ck5sp-copy]{padding-top:calc(.8em + 36px);}',
      '.ck-content pre>.ck5sp-copy-btn{position:absolute;top:10px;right:.4em;z-index:1;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;margin:0;padding:0;border:0;border-radius:6px;background:#e2e8f0;color:#334155;opacity:.5;cursor:pointer;font:inherit;line-height:1;transition:opacity .15s;}',
      '.ck-content pre>.ck5sp-copy-btn:hover,.ck-content pre>.ck5sp-copy-btn:focus-visible{opacity:1;}',
      '.ck-content pre>.ck5sp-copy-btn:focus-visible{outline:2px solid currentColor;outline-offset:1px;}',
      '.ck-content pre>.ck5sp-copy-btn svg{display:block;width:16px;height:16px;}',
      'html.dark .ck-content pre>.ck5sp-copy-btn{background:#334155;color:#e2e8f0;}',
      '@media print{.ck-content pre>.ck5sp-copy-btn{display:none;}}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(s);
  }

  /** 복사할 텍스트: 직계 `code` 가 있으면 그 글자, 없으면 버튼을 뺀 `pre` 글자. */
  function codeCopyText(pre) {
    for (var i = 0; i < pre.children.length; i++) {
      if (pre.children[i].tagName === 'CODE') return pre.children[i].textContent;
    }
    var clone = pre.cloneNode(true);
    var btns = clone.querySelectorAll('.ck5sp-copy-btn');
    for (var j = 0; j < btns.length; j++) btns[j].parentNode.removeChild(btns[j]);
    return clone.textContent;
  }

  function copyByTextarea(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '-9999px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    var ok = false;
    try {
      ta.select();
      ok = document.execCommand('copy');
    } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  function copyCodeText(text, done) {
    var fallback = function (why) {
      if (copyByTextarea(text)) done();
      else codeCopyWarn(why || 'execCommand copy returned false');
    };
    var clip = navigator.clipboard;
    if (clip && typeof clip.writeText === 'function') {
      try {
        clip.writeText(text).then(done, function (err) { fallback(err); });
        return;
      } catch (e) { /* 아래 대체 경로 */ }
    }
    fallback();
  }

  function showCodeCopied(btn) {
    btn.setAttribute('data-state', 'done');
    btn.setAttribute('aria-label', codeCopyLabel(true));
    btn.innerHTML = CHECK_ICON;
    clearTimeout(btn._ck5spCopyTimer);
    btn._ck5spCopyTimer = setTimeout(function () {
      btn.removeAttribute('data-state');
      btn.setAttribute('aria-label', codeCopyLabel(false));
      btn.innerHTML = COPY_ICON;
    }, CODE_COPY_DONE_MS);
  }

  function attachCodeCopyButton(pre) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ck5sp-copy-btn';
    btn.setAttribute('aria-label', codeCopyLabel(false));
    btn.innerHTML = COPY_ICON;
    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      copyCodeText(codeCopyText(pre), function () { showCodeCopied(btn); });
    });
    pre.setAttribute('data-ck5sp-copy', '1');
    pre.insertBefore(btn, pre.firstChild);
    if (!pre._ck5spCopyScroll) {
      pre._ck5spCopyScroll = true;
      pre.addEventListener('scroll', function () {
        var b = pre.querySelector(':scope > .ck5sp-copy-btn');
        if (b) b.style.transform = pre.scrollLeft ? 'translateX(' + pre.scrollLeft + 'px)' : '';
      }, { passive: true });
    }
  }

  /** 방문자 본문의 코드 블록마다 복사 버튼을 단다(이미 있으면 건너뜀). */
  function addCodeCopyButtons(root) {
    var pres;
    try { pres = (root || document).querySelectorAll('pre'); } catch (e) { return; }
    if (!pres.length) return;
    injectCodeCopyStyle();
    for (var i = 0; i < pres.length; i++) {
      var pre = pres[i];
      if (!pre.closest('.ck-content')) continue;
      if (pre.closest('.ck-editor__editable, .ck-editor, .g7ce-wrapper')) continue;
      if (pre.querySelector(':scope > .ck5sp-copy-btn')) continue;
      try { attachCodeCopyButton(pre); } catch (e) { codeCopyWarn(e); }
    }
  }

  // 게이트 없음: 다른 방문자 기능이 모두 꺼져 있어도 root 에 한 번 돈다(코드 복사는 설정 없이 항상 켜짐).
  core.section({
    name: 'code-copy',
    scope: 'visitor',
    order: 20,
    load: 'eager',
    styles: [CODE_COPY_STYLE_ID],
    visitor: addCodeCopyButtons
  });

