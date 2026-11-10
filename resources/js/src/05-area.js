  /** el 이 CKEditor 편집 영역(본문·댓글 편집기) 안이면 true. 편집 영역도 `.ck-content` 라 방문자 스캔에서 뺄 때 쓴다. */
  function isEditingArea(el) {
    return !!(el && el.closest && el.closest('.ck-editor__editable, .ck-editor'));
  }

  /** 살아있는 CKEditor 인스턴스를 컨테이너 근처에서 찾는다. */
  function editorInstanceNear(container) {
    var scopes = [container, container.parentElement, container.nextElementSibling];
    for (var i = 0; i < scopes.length; i++) {
      var sc = scopes[i];
      if (!sc || !sc.querySelectorAll) continue;
      var eds = sc.querySelectorAll('.ck-editor__editable_inline, .ck-editor__editable');
      for (var j = 0; j < eds.length; j++) {
        if (eds[j].ckeditorInstance) return eds[j].ckeditorInstance;
      }
    }
    return null;
  }

  /* ---------------------------------------------------------------- *
   *  화면 판별 (1.7.0) — 글 보기(B)·글쓰기 도우미(C) 범위
   * ---------------------------------------------------------------- */

  /**
   * 게시글 본문 에디터 컨테이너 판정 — 모든 기능이 이것만 쓴다(1.7.0, 1.5.0 코드 서식·에디터 스타일 결함 수정).
   * sirsoft-ckeditor5 1.1 부터 컨테이너에 `ckeditor5-wrapper` 클래스가 없고 `id="ckeditor5-<이름>"` 만 있다
   * (1.0 은 클래스). 둘 다 받는다. 댓글 에디터(g7-comment-editor 의 `.g7ce-wrapper`)는 제외.
   */
  var POST_EDITOR_SELECTORS = ['.ckeditor5-wrapper', 'div[id^="ckeditor5-"]'];
  var POST_EDITOR_SEL = POST_EDITOR_SELECTORS.join(', ');
  var COMMENT_EDITOR_SEL = '.g7ce-wrapper';

  /** el 이 게시글 본문 에디터 컨테이너이거나 그 안이면 true(댓글 에디터 안은 false) */
  function isPostEditorEl(el) {
    return !!(el && el.closest && el.closest(POST_EDITOR_SEL) && !el.closest(COMMENT_EDITOR_SEL));
  }

  /** CSS 선택자 목록: 본문 에디터 컨테이너 각각 뒤에 suffix 를 붙여 쉼표로 잇는다(앞에 prefix). 순수 함수. */
  function postEditorCss(suffix, prefix) {
    return POST_EDITOR_SELECTORS.map(function (s) { return (prefix || '') + s + (suffix ? ' ' + suffix : ''); }).join(',');
  }

  /** 문서의 본문 에디터 컨테이너 중 편집 영역을 품은 바깥쪽 것들(겹치면 바깥 하나) */
  function postEditorContainers(root) {
    var list = (root || document).querySelectorAll(POST_EDITOR_SEL);
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (!c.querySelector('.ck-editor__editable') || c.closest(COMMENT_EDITOR_SEL)) continue;
      var parent = c.parentElement && c.parentElement.closest(POST_EDITOR_SEL);
      if (parent && out.indexOf(parent) !== -1) continue;
      out.push(c);
    }
    return out;
  }

  /** 템플릿 작성자용 본문 표식. 이 속성(또는 같은 이름의 클래스)이 본문 `.ck-content` 자신이나 조상에 있으면 그 본문만 쓴다. */
  var POST_BODY_ATTR = 'data-g7-post-body';
  var POST_BODY_CLASS = 'g7-post-body';

  /** 경로 종류: 'detail'(글 상세) · 'write'(사용자 글쓰기·수정) · ''(그 밖). wc-community routes.json 기준. */
  function routeKind(pathname) {
    var p = String(pathname == null ? (window.location && window.location.pathname) || '' : pathname).replace(/\/+$/, '');
    var m = p.match(/^\/board\/[^/]+\/([^/]+)(?:\/([^/]+))?$/);
    if (!m) return '';
    if (!m[2]) return m[1] === 'write' ? 'write' : 'detail';
    return m[2] === 'edit' ? 'write' : '';
  }

  /** 본문 후보에서 빼는 자리: 모달·대화상자, 댓글 영역, 댓글 승격 본문 */
  var NOT_POST_BODY = '[role="dialog"], [aria-modal="true"], [data-g7-anchor^="comment"], p[data-g7ce], .g7ce-wrapper';

  /**
   * 글 상세 화면의 글 본문 `.ck-content` 하나를 찾는다. 없으면 null.
   *  1. 표식(`data-g7-post-body` 속성 또는 `g7-post-body` 클래스)이 있으면 그 안(또는 그 자신)의 본문
   *  2. 없으면 추정: 글 상세 경로에서 `[data-g7-anchor="post-actions"]`(버튼 줄) 앞의 마지막 본문.
   *     버튼 줄이 없으면 글자가 가장 많은 본문.
   * 편집 영역·모달·댓글 영역 안의 `.ck-content` 는 후보가 아니다.
   */
  function findMainBody(root) {
    root = root || document;
    var marked = root.querySelector('[' + POST_BODY_ATTR + '], .' + POST_BODY_CLASS);
    if (marked) {
      if (marked.classList && marked.classList.contains('ck-content') && !isEditingArea(marked)) return marked;
      var inner = marked.querySelectorAll('.ck-content');
      for (var k = 0; k < inner.length; k++) {
        if (!isEditingArea(inner[k]) && !inner[k].closest(NOT_POST_BODY)) return inner[k];
      }
      return null;
    }
    if (routeKind() !== 'detail') return null;
    var all = root.querySelectorAll('.ck-content');
    var cands = [];
    for (var i = 0; i < all.length; i++) {
      var c = all[i];
      if (isEditingArea(c) || c.closest(NOT_POST_BODY)) continue;
      cands.push(c);
    }
    if (!cands.length) return null;
    var actions = root.querySelector('[data-g7-anchor="post-actions"]');
    if (actions && actions.compareDocumentPosition) {
      var best = null;
      for (var j = 0; j < cands.length; j++) {
        // 후보가 버튼 줄보다 앞(PRECEDING 아님 = 버튼 줄이 뒤 = FOLLOWING)
        if (cands[j].compareDocumentPosition(actions) & 4) best = cands[j];
      }
      return best;
    }
    var most = null;
    var mostLen = -1;
    for (var n = 0; n < cands.length; n++) {
      var len = (cands[n].textContent || '').length;
      if (len > mostLen) { most = cands[n]; mostLen = len; }
    }
    return most;
  }

