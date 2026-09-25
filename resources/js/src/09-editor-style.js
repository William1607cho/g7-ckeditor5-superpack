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
   *  - **편집 화면**: 순수 CSS 셀렉터로는 게시글 본문 에디터와 댓글 에디터의
   *    `.ck-content`를 구분할 표식이 없어(둘 다 CKEditor5가 자동으로 붙이는
   *    클래스), **살아있는 에디터 인스턴스**를 직접 찾아(컨테이너 셀렉터 자체가
   *    이미 댓글 에디터의 `g7ce-wrapper`를 구조적으로 배제) 그 DOM 루트에만 마커
   *    클래스를 붙인다 — "댓글에도 적용" 옵션은 방문자 화면(렌더링된 댓글)에만
   *    적용되고 댓글 작성 화면(입력창) 자체는 대상이 아니다.
   *
   * font-size/line-height 는 `ckeditor5.css`에 `.ck-content` 베이스 규칙이 아예
   * 없어(조사 확인) 경합 대상 자체가 없지만, 로드 순서가 결정론적이지 않은 동적
   * 주입 CSS(둘 다 런타임에 <head>/DOM 에 붙음)라는 특성상 `!important`로 안전하게
   * 고정한다.
   */

  var EDITOR_STYLE_ID = 'ck5sp-editor-style';
  var EDITOR_STYLE_MARKER = 'ck5sp-body-editor-style';

  /** 관리자 설정값으로 <style> 태그를 생성/갱신/제거한다(멱등). */
  function injectEditorStyleCss(cfg) {
    var existing = document.getElementById(EDITOR_STYLE_ID);
    if (!cfg.editorStyleEnabled) {
      if (existing) existing.remove();
      return;
    }
    var selectors = ['.ck-content.prose'];
    if (cfg.editorApplyToComments) selectors.push('p.text-gray-700.dark\\:text-gray-300');
    var rule = 'font-size:' + cfg.editorFontSize + 'px!important;line-height:' + cfg.editorLineHeight + '!important;';
    var css = selectors.join(',') + '{' + rule + '}'
      + '.' + EDITOR_STYLE_MARKER + '{' + rule + '}';
    if (existing) {
      if (existing.textContent !== css) existing.textContent = css;
      return;
    }
    var el = document.createElement('style');
    el.id = EDITOR_STYLE_ID;
    el.textContent = css;
    document.head.appendChild(el);
  }

  /** 편집기 컨테이너 하나의 실제 편집 DOM 루트에 마커 클래스를 붙이거나 뗀다. */
  function attachEditorStyleTo(container) {
    var cfg = readSettings();
    var editor = editorInstanceNear(container);
    if (!editor) return;
    var domRoot = null;
    try { domRoot = editor.editing.view.getDomRoot(); } catch (e) {}
    if (!domRoot) return;
    if (domRoot.classList.contains(EDITOR_STYLE_MARKER) !== !!cfg.editorStyleEnabled) {
      domRoot.classList.toggle(EDITOR_STYLE_MARKER, !!cfg.editorStyleEnabled);
    }
  }

  function scanEditors() {
    // 동영상 업로드 바/에디터 스타일 마커 둘 다 켜짐 여부를 각자 내부에서
    // 확인하므로(attachUploaderTo, attachEditorStyleTo) 여기선 컨테이너 존재만
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
      attachEditorStyleTo(cont);
      attachPasteImageHandlerTo(cont);
      ensureSubmitGuardListener();
    }
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

