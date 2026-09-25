  /* ================================================================ *
   *  이미지 업로드 완료 전 "글 작성 완료" 제출 방지
   * ================================================================ *
   *  실측 확인(재현): 이미지 붙여넣기(클립보드 파일이든 스크린샷이든 동일) 직후
   *  CKEditor5 는 모델에 `<img>` 를 즉시 넣지만 `src` 는 업로드가 끝나기 전까지
   *  아예 비워둔다(`ImageUploadEditing._uploadImage` — 벤더 소스 확인). 업로드가
   *  끝나기 전에 "글 작성 완료" 를 누르면 `editor.getData()` 가 그 순간의 상태
   *  그대로 `<img>`(src 속성 자체가 없음)를 돌려주고, 이 사이트의 게시글 폼은
   *  그 값을 그대로 저장한다 — 검증 결과 DB 에 `<figure class="image"><img></figure>`
   *  로 영구 저장되어 이미지 자리가 완전히 빈칸으로 남는다(재현 성공, 게시글 id
   *  38 로 실측). CKEditor5 는 이 상황을 위해 표준 `PendingActions` 플러그인을
   *  이미 제공한다(`FileRepository` 가 `requires` 로 자동 로드 — 별도 플러그인
   *  등록 불필요, 실측으로 `editor.plugins.get('PendingActions').hasAny` 가
   *  업로드 중 `true` 로 바뀌는 것 확인). 문제는 sirsoft-board 의 게시글 폼이
   *  이 표준 신호를 전혀 확인하지 않는다는 것(코드 전수 검색 결과 0건) — 그래서
   *  여기서 "글 작성 완료" 버튼 클릭을 캡처 단계에서 먼저 가로채, 등록된 에디터
   *  중 하나라도 업로드가 진행 중이면 표준 `PendingActions.hasAny` 를 근거로
   *  제출 자체를 막는다. sirsoft-board/sirsoft-basic 폼 정의(JSON)는 수정하지
   *  않는다(무변경 원칙) — 이 감시도 다른 슈퍼팩 기능과 동일하게 전역 스크립트의
   *  캡처 리스너로만 구현한다. 스크린샷 붙여넣기도 동일한 업로드 파이프라인을
   *  타므로 이 가드가 자동으로 함께 보호한다(신규 클립보드 붙여넣기 기능만의
   *  문제가 아니라 sirsoft-ckeditor5 의 기존 구조적 공백이었음).
   */

  var submitGuardBound = false;

  /** 폼 안에 등록된 에디터 중 업로드가 진행 중인 PendingActions 를 찾는다. */
  function findPendingUploadIn(form) {
    for (var i = 0; i < pasteImageRoots.length; i++) {
      var entry = pasteImageRoots[i];
      if (!entry.domRoot || !form.contains(entry.domRoot)) continue;
      try {
        var pa = entry.editor.plugins.get('PendingActions');
        if (pa && pa.hasAny) return pa;
      } catch (e) {}
    }
    return null;
  }

  /** document 캡처 단계에서 게시글 폼의 제출 버튼 클릭을 감시한다 (1회만 등록). */
  function ensureSubmitGuardListener() {
    if (submitGuardBound || typeof document === 'undefined') return;
    submitGuardBound = true;
    document.addEventListener('click', function (evt) {
      var btn = evt.target && evt.target.closest ? evt.target.closest('button') : null;
      if (!btn) return;
      var form = btn.closest('#form');
      if (!form) return;
      // 게시글 폼(#form) 안의 마지막 버튼 = "등록"/"저장" 버튼 (실측 확인 —
      // 취소·카테고리·에디터 툴바 버튼 등은 전부 그 앞에 렌더링됨).
      var formButtons = form.querySelectorAll('button');
      if (!formButtons.length || formButtons[formButtons.length - 1] !== btn) return;

      var pending = findPendingUploadIn(form);
      if (!pending) return; // 업로드 중인 게 없으면 그냥 통과 (정상 제출)

      evt.preventDefault();
      evt.stopPropagation();
      if (evt.stopImmediatePropagation) evt.stopImmediatePropagation();

      var msg = t('editor.image.upload_pending_submit_blocked', '이미지 업로드가 끝날 때까지 잠시만 기다려주세요. 업로드가 끝나면 다시 눌러주세요.');
      notify('warning', msg);
    }, true);
  }

  /* ================================================================ *
   *  등록 버튼 "업로드중" 상태 전환 (위 제출 차단의 1차 방어로 승격)
   * ================================================================ *
   *  위 캡처+토스트 가드는 이제 "혹시 몰라 남겨두는" 이중 안전장치일 뿐이고,
   *  주된 방어는 이 섹션 — 업로드 중에는 버튼 자체를 "업로드중"으로 바꾸고
   *  비활성화해 클릭이 애초에 발생하지 않게 한다(정상 흐름에서는 위 토스트가
   *  뜰 일이 없다 — 버튼이 이미 막혀 있으므로).
   *
   *  여러 이미지가 동시에 업로드 중이어도 표준 `PendingActions.hasAny` 를
   *  그대로 신뢰한다 — `FileRepository` 는 `loaders` 컬렉션 길이가 0 으로
   *  돌아올 때만(즉 모든 로더가 끝났을 때만) pending action 을 제거하므로,
   *  "먼저 끝난 이미지 때문에 버튼이 풀리는" 경우는 표준 동작상 발생하지
   *  않는다(벤더 소스 `_updatePendingAction` 확인 — 별도 카운터 불필요).
   */

  /** 폼(#form) 안에서 제출 버튼(마지막 버튼)을 찾는다. 없으면 null. */
  function findFormSubmitButton(domRoot) {
    var form = domRoot && domRoot.closest ? domRoot.closest('#form') : null;
    if (!form) return null;
    var btns = form.querySelectorAll('button');
    return btns.length ? btns[btns.length - 1] : null;
  }

  /** 버튼 안의 문구 텍스트 노드를 담은 요소를 찾는다(아이콘과 분리된 span 우선). */
  function findButtonLabelNode(btn) {
    return btn.querySelector('span') || btn;
  }

  /** 제출 버튼을 PendingActions.hasAny 에 묶어 "업로드중" 상태를 전환한다 (편집기당 1회). */
  function attachSubmitButtonUploadState(editor, domRoot) {
    var btn = findFormSubmitButton(domRoot);
    if (!btn || btn.__ck5spUploadStateBound) return;
    btn.__ck5spUploadStateBound = true;

    var pendingActions;
    try { pendingActions = editor.plugins.get('PendingActions'); } catch (e) { return; }
    if (!pendingActions) return;

    var labelNode = null;
    var originalLabel = null; // null = 현재 "업로드중" 상태가 아님 (하드코딩 금지 — 실제 버튼 원문을 저장/복원)

    function onHasAny(evt, name, value) {
      if (value) {
        if (originalLabel === null) {
          labelNode = findButtonLabelNode(btn);
          originalLabel = labelNode.textContent;
        }
        labelNode.textContent = t('editor.image.uploading_button_label', '업로드중');
        btn.disabled = true;
      } else if (originalLabel !== null) {
        labelNode.textContent = originalLabel;
        btn.disabled = false;
        originalLabel = null;
      }
    }
    try { pendingActions.on('change:hasAny', onHasAny); } catch (e) { warnOnce('upload state', e); }
  }

  /* ================================================================ *
   *  업로드 멈춤(영구 pending) 안전장치 — 강제 타임아웃
   * ================================================================ *
   *  실측 확인: 3.7MB~8MB대 이미지를 실제로 붙여넣으면 서버 크기 제한
   *  (`imageMaxSizeMb`, 이 사이트는 50MB로 충분히 여유 — 크기 제한에 걸린
   *  게 아님)에는 안 걸리는데도 업로드가 끝나지도 실패하지도 않고 무한정
   *  멈춘다. 원인을 추적한 결과 — php-fpm 워커는 전부 idle(sleeping) 상태로
   *  실제 처리 중이 아니었고, Laravel 로그에도 해당 요청이 전혀 기록되지
   *  않았으며, Cloudflare Tunnel(cloudflared) 로그에 해당 업로드 요청마다
   *  `"Incoming request ended abruptly: context canceled"` 가 정확히 대응되는
   *  것을 확인했다 — 즉 서버(PHP)가 멈춘 게 아니라 **클라이언트→오리진 전송이
   *  중간에 끊기고, XHR 이 그 상태에서 load/error 이벤트를 받지 못해 영원히
   *  대기하는 것**이 근본 원인으로 보인다(정확한 원인 계층 — 터널/네트워크
   *  구간의 문제로 추정 — 은 이 플러그인의 코드 범위 밖이라 이번엔 근본
   *  차단 대신 클라이언트 타임아웃으로 사용자를 무한 대기에서 반드시
   *  풀어주는 안전장치를 넣는다).
   *
   *  `FileRepository.loaders` 컬렉션 레벨에서 건다 — 이 컬렉션은 트리거가
   *  클립보드 붙여넣기든 스크린샷 붙여넣기든 에디터의 다른 업로드 경로든
   *  전부 공유하므로, 이 안전장치는 자동으로 모든 업로드 경로에 공통 적용된다.
   *
   *  **실측으로 드러난 추가 함정**: 벤더 `Loader.abort()`는 상태를 `aborted`로
   *  바꾸고 어댑터의 `xhr.abort()`를 호출할 뿐 — 실제 정리(모델에서 이미지
   *  제거, `FileRepository.loaders`에서 제거, `PendingActions` 해제)는 그
   *  `xhr`가 비동기로 발화하는 네이티브 `abort` 이벤트를 CKEditor5 내부
   *  `ImageUploadEditing._readAndUpload`의 프라미스 체인이 받아야만 일어난다.
   *  이 사이트의 실제 정체 상황(업로드 바디는 100% 전송 완료됐지만 서버
   *  응답이 영영 안 오는 상태 — Cloudflare Tunnel 쪽 절단으로 추정)에서는
   *  **`xhr.abort()`를 호출해도 그 네이티브 `abort` 이벤트가 발화하지 않는
   *  것을 직접 재현·확인했다**(`loader.abort()`를 수동 호출한 뒤 여러 초를
   *  기다려도 `loaders.length`가 줄지 않고 `PendingActions.hasAny`도 계속
   *  `true`로 남음). 그래서 이 타임아웃 가드는 `loader.abort()` 호출에만
   *  기대지 않고, 그 비동기 콜백이 안 와도 사용자가 절대 갇히지 않도록
   *  **모델의 이미지 요소 제거 + `FileRepository.destroyLoader()` 호출을
   *  우리가 직접, 그 자리에서 수행**한다(둘 다 CKEditor5가 공개하는 표준
   *  API — 내부 전용 메서드를 억지로 파고든 게 아니다).
   */

  /** 업로드 하나가 이 시간(ms) 안에 끝나지 않으면 강제로 정리한다.
   * 서버 fastcgi_read_timeout(600s)보다 훨씬 짧게 잡아, 사용자가 실제로
   * 체감하기 전에 안내와 함께 풀어준다. */
  var UPLOAD_STUCK_TIMEOUT_MS = 45000;

  /** 모델에서 이 uploadId 를 가진 이미지 요소를 찾아 제거한다(있으면). */
  function removeStuckUploadImageElement(editor, uploadId) {
    var root = editor.model.document.getRoot();
    var target = null;
    var walker = editor.model.createRangeIn(root).getWalker({ ignoreElementEnd: true });
    for (var step = walker.next(); !step.done; step = walker.next()) {
      var value = step.value;
      var item = value.item;
      if (item.getAttribute && item.getAttribute('uploadId') === uploadId) {
        target = item;
        break;
      }
    }
    if (target) {
      editor.model.change(function (writer) { writer.remove(target); });
    }
  }

  /** 편집기 하나의 FileRepository 에 강제 타임아웃 가드를 붙인다(편집기당 1회). */
  function attachUploadTimeoutGuard(editor) {
    if (editor.__ck5spUploadTimeoutGuard) return;
    editor.__ck5spUploadTimeoutGuard = true;

    var fileRepo;
    try { fileRepo = editor.plugins.get('FileRepository'); } catch (e) { return; }
    if (!fileRepo) return;

    fileRepo.loaders.on('add', function (evt, loader) {
      var settled = false;

      var timer = window.setTimeout(function () {
        if (settled) return;
        settled = true;

        try { loader.abort(); } catch (e) {}
        // xhr.abort() 의 비동기 콜백을 기다리지 않고 즉시 직접 정리한다
        // (위 주석 — 이 환경에서 그 콜백이 오지 않는 경우를 실측 확인).
        try { removeStuckUploadImageElement(editor, loader.id); } catch (e) {}
        try { fileRepo.destroyLoader(loader); } catch (e) {}

        var msg = t('editor.image.upload_timeout', '이미지 업로드가 너무 오래 걸려 취소되었습니다. 파일 크기나 네트워크 상태를 확인한 뒤 다시 시도해주세요.');
        notify('error', msg);
      }, UPLOAD_STUCK_TIMEOUT_MS);

      function onRemoved(evt2, removedItem) {
        if (removedItem !== loader) return;
        settled = true;
        window.clearTimeout(timer);
        fileRepo.loaders.off('remove', onRemoved);
      }
      fileRepo.loaders.on('remove', onRemoved);
    });
  }

  // 제출 가드는 컨테이너마다 불리지만 document 리스너는 한 번만 건다(submitGuardBound).
  core.section({
    name: 'upload-guards',
    scope: 'editor',
    editorOrder: 30,
    load: 'eager',
    editor: ensureSubmitGuardListener
  });

