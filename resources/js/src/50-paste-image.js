  /* ================================================================ *
   *  클립보드 이미지 붙여넣기 — 웹페이지 "이미지 복사" → 우리 서버 업로드
   * ================================================================ *
   *  CKEditor5 네이티브 ImageUpload 의 clipboardInput 리스너는(dist/vendor
   *  ckeditor5.umd.js 실측) `dataTransfer.types` 에 `text/html` 이 있고 그
   *  값이 비어있지 않으면 — 파일 바이너리가 함께 있어도 — 그냥 return 하고
   *  업로드를 시도하지 않는다. 브라우저에서 웹페이지 이미지를 "이미지 복사"하면
   *  많은 사이트가 클립보드에 실제 이미지 바이너리와 `<img src="외부URL">`
   *  text/html 을 동시에 담으므로, 네이티브 경로로는 바이너리를 무시하고 외부
   *  URL 이 그대로 본문에 삽입된다(화면엔 정상 렌더 → 원본 삭제/핫링크 차단 시
   *  깨지는 조용한 실패).
   *
   *  여기서는 `document` 캡처 단계에서 paste 를 먼저 가로채(도달 순서상 항상
   *  에디터 자신의 리스너보다 앞선다) 클립보드 아이템 중 kind==='file' &&
   *  type이 'image/'로 시작하는 바이너리가 있으면, 그 즉시 htm 처리를 막고
   *  기존 로컬 업로드 경로(SimpleUploadAdapter → sirsoft-ckeditor5 업로드
   *  엔드포인트)를 그대로 쓰는 `uploadImage` 커맨드를 직접 실행한다. 서버로
   *  외부 URL 을 재요청(재호스팅)하는 방식은 이전 라운드에서 사이트별로
   *  불안정(CORS 차단·조용한 실패·우클릭 자체 차단)해 전량 롤백했으므로
   *  이번엔 시도하지 않는다 — 바이너리가 없으면 아무 것도 하지 않고 CKEditor5
   *  기본 동작에 맡긴다.
   *
   *  게시글 본문 편집기에만 적용한다. 댓글 에디터(`g7ce-wrapper` 안)는
   *  attachPasteImageHandlerTo 에서 명시적으로 건너뛴다(업로드 경로가 없음).
   */

  var pasteImageRoots = []; // [{ domRoot, editor }]
  var pasteImageListenerBound = false;

  /** 클립보드 아이템에서 이미지 파일 바이너리만 추출한다 (없으면 빈 배열). */
  function extractClipboardImageFiles(clipboardData) {
    var files = [];
    if (!clipboardData || !clipboardData.items) return files;
    for (var i = 0; i < clipboardData.items.length; i++) {
      var item = clipboardData.items[i];
      if (item && item.kind === 'file' && item.type && item.type.indexOf('image/') === 0) {
        var f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    return files;
  }

  /**
   * sirsoft-ckeditor5 관리자 설정에 실제 저장된 업로드 최대 크기(MB)를 읽는다.
   * 서버 검증(`ImageUploadRequest`)이 이 값을 그대로 쓰므로, 클라이언트 사전
   * 차단 기준도 임의 숫자가 아니라 이 값을 그대로 따른다.
   */
  function getCkeditor5MaxUploadMb() {
    try {
      var gs = window.G7Core.state.get();
      var settings = (gs._global && gs._global.plugins && gs._global.plugins['sirsoft-ckeditor5'])
        || (gs.plugins && gs.plugins['sirsoft-ckeditor5']);
      var n = parseInt(settings && settings.imageMaxSizeMb, 10);
      return n > 0 ? n : null;
    } catch (e) {
      return null;
    }
  }

  /** 사용자 안내: G7Core 토스트(level = 'warning' | 'error')가 없으면 alert(이미지 업로드 기능 공용). */
  function notify(level, msg) {
    var toast = window.G7Core && window.G7Core.toast;
    if (toast && typeof toast[level] === 'function') toast[level](msg);
    else { try { window.alert(msg); } catch (e) {} }
  }

  /** 붙여넣은 파일들을 기존 로컬 이미지 업로드 경로(uploadImage 커맨드)로 넘긴다.
   * 서버 크기 제한을 이미 넘는 파일은 업로드를 아예 시도하지 않고 즉시 안내한다
   * (사후 타임아웃보다 나은 사용자 경험 — 불필요한 대기 자체를 없앤다).
   */
  function uploadPastedImages(editor, files) {
    var maxMb = getCkeditor5MaxUploadMb();
    var maxBytes = maxMb ? maxMb * 1024 * 1024 : null;
    var accepted = [];
    var rejected = [];
    for (var i = 0; i < files.length; i++) {
      if (maxBytes && files[i].size > maxBytes) rejected.push(files[i]);
      else accepted.push(files[i]);
    }
    if (rejected.length) {
      var msg = t('editor.image.too_large_client_check', '이미지 파일이 너무 큽니다(최대 {max}MB). 더 작은 이미지로 다시 시도해주세요.').replace('{max}', String(maxMb));
      notify('warning', msg);
    }
    if (!accepted.length) return;
    try {
      editor.execute('uploadImage', { file: accepted });
    } catch (e) {
      try { console.warn('[g7-ckeditor5-superpack] 클립보드 이미지 업로드 실행 실패:', e); } catch (e2) {}
    }
  }

  /** document 캡처 단계 paste 리스너를 1회만 등록한다. */
  function ensurePasteImageListener() {
    if (pasteImageListenerBound || typeof document === 'undefined') return;
    pasteImageListenerBound = true;
    document.addEventListener('paste', function (evt) {
      for (var i = 0; i < pasteImageRoots.length; i++) {
        var entry = pasteImageRoots[i];
        if (!entry.domRoot || !entry.domRoot.isConnected || !entry.domRoot.contains(evt.target)) continue;

        var cd = evt.clipboardData || (evt.originalEvent && evt.originalEvent.clipboardData);
        var files = extractClipboardImageFiles(cd);
        if (!files.length) return; // 바이너리 없음 → CKEditor5 기본 동작에 맡김

        evt.preventDefault();
        evt.stopPropagation();
        if (evt.stopImmediatePropagation) evt.stopImmediatePropagation();
        uploadPastedImages(entry.editor, files);
        return;
      }
    }, true);
  }

  /** 편집기 컨테이너 하나를 클립보드 이미지 붙여넣기 대상으로 등록한다 (중복 방지).
   * "이미지 복붙" 탭의 imagepaste_enabled 설정이 꺼져 있으면 등록 자체를 하지 않는다 —
   * pasteImageRoots 에 아무 것도 안 쌓이므로 document 캡처 리스너(ensurePasteImageListener)
   * 도 필요 없어져 결과적으로 이 플러그인의 클립보드 가로채기가 전부 비활성화되고
   * sirsoft-ckeditor5 기본 동작(스크린샷 붙여넣기는 계속 되지만 제출 방지 가드는 빠짐,
   * attachSubmitButtonUploadState/attachUploadTimeoutGuard 도 이 함수 안에서만 걸리므로
   * 같이 꺼진다)으로 돌아간다. */
  function attachPasteImageHandlerTo(container) {
    if (container.__ck5spPasteImage) return;
    var cfg = readSettings();
    if (!cfg.imagePasteEnabled) return;
    var editor = editorInstanceNear(container);
    if (!editor) return;
    var domRoot;
    try { domRoot = editor.editing.view.getDomRoot(); } catch (e) { return; }
    if (!domRoot) return;
    if (domRoot.closest('.g7ce-wrapper')) return; // 댓글 편집기는 이미지 업로드 경로가 없다
    container.__ck5spPasteImage = true;
    for (var pr = pasteImageRoots.length - 1; pr >= 0; pr--) {
      if (!pasteImageRoots[pr].domRoot || !pasteImageRoots[pr].domRoot.isConnected) pasteImageRoots.splice(pr, 1); // SPA 이동으로 끊긴 편집기 정리
    }
    pasteImageRoots.push({ domRoot: domRoot, editor: editor });
    ensurePasteImageListener();
    attachSubmitButtonUploadState(editor, domRoot);
    attachUploadTimeoutGuard(editor);
  }

  core.section({
    name: 'image-paste',
    scope: 'editor',
    editorOrder: 20,
    load: 'eager',
    editor: attachPasteImageHandlerTo
  });

