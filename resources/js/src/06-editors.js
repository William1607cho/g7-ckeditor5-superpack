  function scanEditors() {
    // 동영상 업로드 바/이미지 복붙 둘 다 켜짐 여부를 각자 내부에서
    // 확인하므로(attachUploaderTo, attachPasteImageHandlerTo) 여기선 컨테이너 존재만
    // 확인한다. (이전엔 `if (!cfg.videoEnabled) return;` 로 videoEnabled 가
    // 꺼지면 이 순회 자체를 건너뛰었는데, 그러면 videoEnabled 와 무관한 다른
    // 기능까지 함께 막히므로 제거했다 — 각 attach 함수가 자기 설정을 스스로
    // 확인하는 현재 구조가 버그 없이 이미 검증됨, 원복하지 않고 유지)
    try { ensureChunks(readSettings(), 'editor'); } catch (e) { warnOnce('chunks (editor)', e); }
    // 본문 에디터 컨테이너(05-area 의 한 판정 — sirsoft 1.1 id 컨테이너·옛 클래스, 댓글 에디터 제외)
    var containers = postEditorContainers(document);
    for (var i = 0; i < containers.length; i++) {
      var cont = containers[i];
      if (!document.body.contains(cont)) continue;
      if (!editorInstanceNear(cont)) continue;
      runEditors(cont);
    }
    // 편집 스타일 표식은 위 컨테이너 목록과 무관하게 고정 구조로 찾는다.
    runEditorEnds();
  }

