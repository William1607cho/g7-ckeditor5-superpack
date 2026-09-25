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

