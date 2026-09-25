  /* ================================================================ *
   *  로컬 동영상 — 편집 화면 업로드 UI (관리자)
   * ================================================================ */

  var UPLOAD_STYLE_ID = 'ck5-video-upload-style';
  var VIDEO_INIT = '/api/plugins/' + IDENTIFIER + '/video/upload/init';
  var VIDEO_CHUNK = '/api/plugins/' + IDENTIFIER + '/video/upload/chunk';
  var VIDEO_COMPLETE = '/api/plugins/' + IDENTIFIER + '/video/upload/complete';

  function authToken() {
    try {
      if (window.G7Core && window.G7Core.apiClient && window.G7Core.apiClient.getToken) {
        return window.G7Core.apiClient.getToken() || '';
      }
    } catch (e) {}
    try { return localStorage.getItem('auth_token') || ''; } catch (e) { return ''; }
  }

  function injectUploadStyle() {
    if (document.getElementById(UPLOAD_STYLE_ID)) return;
    var el = document.createElement('style');
    el.id = UPLOAD_STYLE_ID;
    // 편집기 본문의 동영상 링크 = 박스형 카드. class/data-* 는 CKEditor Link 가 지우므로
    // (실측) **href 속성 선택자**로만 스타일. 조회 화면(.ck-content, editable 밖)엔 미적용.
    var VBOX = '.ck-editor__editable a[href*="/api/plugins/g7-ckeditor5-superpack/video/"]';
    el.textContent = ''
      + '.ck5sp-vbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:6px 0 2px;font-size:13px;}'
      + '.ck5sp-vbar__btn{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border:1px solid #cbd5e1;border-radius:8px;background:#f8fafc;color:#0f172a;cursor:pointer;font-weight:600;line-height:1.2;}'
      + '.ck5sp-vbar__btn:hover{background:#eef2f7;}'
      + '.ck5sp-vbar__btn[disabled]{opacity:.55;cursor:default;}'
      + 'html.dark .ck5sp-vbar__btn{background:#1e293b;border-color:#334155;color:#e2e8f0;}'
      + '.ck5sp-vbar__hint{color:#64748b;}'
      + 'html.dark .ck5sp-vbar__hint{color:#94a3b8;}'
      + '.ck5sp-vbar__prog{flex:1 1 160px;min-width:120px;height:8px;border-radius:9999px;background:#e2e8f0;overflow:hidden;display:none;}'
      + 'html.dark .ck5sp-vbar__prog{background:#334155;}'
      + '.ck5sp-vbar__prog>span{display:block;height:100%;width:0;background:#2563eb;transition:width .2s;}'
      + '.ck5sp-vbar__msg{color:#b91c1c;}'
      + 'html.dark .ck5sp-vbar__msg{color:#fca5a5;}'
      // ---- 미디어 라이브러리 스트립 (편집기 위) ----
      + '.ck5sp-vlib{margin:6px 0 10px;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc;padding:8px 10px;}'
      + 'html.dark .ck5sp-vlib{background:#0f172a;border-color:#334155;}'
      + '.ck5sp-vlib[hidden]{display:none;}'
      + '.ck5sp-vlib__head{font-size:12px;font-weight:600;color:#475569;margin-bottom:6px;}'
      + 'html.dark .ck5sp-vlib__head{color:#94a3b8;}'
      + '.ck5sp-vlib__list{display:flex;flex-wrap:wrap;gap:10px;}'
      + '.ck5sp-vlib__card{width:210px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;background:#fff;}'
      + 'html.dark .ck5sp-vlib__card{background:#1e293b;border-color:#334155;}'
      + '.ck5sp-vlib__card>video{display:block;width:100%;height:112px;object-fit:cover;background:#000;}'
      + '.ck5sp-vlib__name{font-size:11px;color:#475569;padding:5px 7px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}'
      + 'html.dark .ck5sp-vlib__name{color:#cbd5e1;}'
      + '.ck5sp-vlib__row{display:flex;align-items:center;gap:4px;padding:5px 7px 7px;}'
      + '.ck5sp-vlib__sz{border:1px solid #cbd5e1;background:#f1f5f9;color:#475569;border-radius:5px;font-size:10px;line-height:1;padding:3px 6px;cursor:pointer;}'
      + '.ck5sp-vlib__sz.is-on{background:#2563eb;border-color:#2563eb;color:#fff;}'
      + 'html.dark .ck5sp-vlib__sz{background:#334155;border-color:#475569;color:#cbd5e1;}'
      + '.ck5sp-vlib__ins{margin-left:auto;border:0;background:#2563eb;color:#fff;border-radius:6px;font-size:11px;font-weight:600;padding:4px 9px;cursor:pointer;}'
      + '.ck5sp-vlib__ins:hover{background:#1d4ed8;}'
      // ---- 편집기 본문 박스 카드 (href 속성 선택자, GHS 무관) ----
      + VBOX + '{display:flex!important;align-items:center;justify-content:center;box-sizing:border-box;'
      +   'width:480px;max-width:100%;min-height:120px;margin:10px auto;padding:12px 16px;'
      +   'border:1px solid #cbd5e1;border-radius:10px;background:#f1f5f9;color:#0f172a!important;'
      +   'font-weight:600;text-decoration:none!important;text-align:center;line-height:1.4;word-break:break-all;}'
      + VBOX + '::before{content:"\\25B6";margin-right:8px;color:#2563eb;font-size:13px;flex-shrink:0;}'
      + VBOX + '[href*="size=sm"]{width:320px;min-height:92px;}'
      + VBOX + '[href*="size=lg"]{width:640px;min-height:184px;}'
      + 'html.dark ' + VBOX + '{background:#1e293b;border-color:#334155;color:#e2e8f0!important;}'
      + 'html.dark ' + VBOX + '::before{color:#60a5fa;}';
    document.head.appendChild(el);
  }

  /** 살아있는 CKEditor 인스턴스를 컨테이너 근처에서 찾는다. */
  function editorInstanceNear(container) {
    var scopes = [container, container.parentElement, container.nextElementSibling, document];
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

  /** URL 에 size 힌트를 얹는다 ('md' 는 파라미터 없음 = 기본). GHS 는 href 쿼리는 보존함(실측). */
  function videoUrlWithSize(url, size) {
    var base = String(url).replace(/[?&]size=(sm|md|lg)\b/gi, '').replace(/[?&]$/, '');
    if (size === 'sm' || size === 'lg') {
      base += (base.indexOf('?') === -1 ? '?' : '&') + 'size=' + size;
    }
    return base;
  }

  /**
   * 동영상 링크 한 줄을 현재 커서 위치에 삽입한다.
   * 에디터가 포커스 아웃 등으로 선택이 유효하지 않으면 **문서 끝**에 삽입(자연스러운 폴백).
   *
   * CKEditor 5 43.3.1 은 GHS 와일드카드로도 `<video>`·`<a class>` 를 본문 모델에 담지
   * 못하므로(실측) 본문엔 순수 링크만. 편집 화면에선 href 속성 선택자 CSS 가 박스 카드로
   * 보이게 하고, 방문자 화면에선 렌더러가 `<video>` 로 승격한다.
   */
  function insertVideoLink(editor, url, name, size) {
    var u = videoUrlWithSize(url, size || 'md');
    var html = '<p><a href="' + esc(u) + '">' + esc(name || u) + '</a></p>';
    var mf;
    try {
      mf = editor.data.toModel(editor.data.processor.toView(html));
    } catch (e) {
      try { editor.setData((editor.getData() || '') + html); } catch (e1) {}
      try { editor.editing.view.focus(); } catch (e1) {}
      return;
    }
    var focused = false;
    try { focused = !!(editor.editing && editor.editing.view && editor.editing.view.document && editor.editing.view.document.isFocused); } catch (e) {}
    try {
      if (focused) editor.model.insertContent(mf);
      else editor.model.insertContent(mf, editor.model.document.getRoot(), 'end');
    } catch (e) {
      try { editor.setData((editor.getData() || '') + html); } catch (e2) {}
    }
    try { editor.editing.view.focus(); } catch (e) {}
  }

  function humanMb(bytes) { return (bytes / 1024 / 1024).toFixed(1); }

  /** 파일 하나를 청크로 업로드. onProgress(0..1), 완료 시 resolve({id,url,name}). */
  function chunkedUpload(file, cfg, onProgress) {
    var token = authToken();
    var headers = token ? { Authorization: 'Bearer ' + token } : {};
    var totalChunks = Math.max(1, Math.ceil(file.size / (cfg.videoChunkMb * 1024 * 1024)));

    return fetch(VIDEO_INIT, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json', Accept: 'application/json' }, headers),
      body: JSON.stringify({ filename: file.name, size: file.size, mime: file.type || 'video/mp4', total_chunks: totalChunks })
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.j && res.j.message ? res.j.message : 'init 실패');
        var sessionKey = res.j.session_key;
        var chunkSize = res.j.chunk_size || (cfg.videoChunkMb * 1024 * 1024);
        var count = Math.max(1, Math.ceil(file.size / chunkSize));

        var sendChunk = function (index) {
          if (index >= count) {
            return fetch(VIDEO_COMPLETE, {
              method: 'POST',
              headers: Object.assign({ 'Content-Type': 'application/json', Accept: 'application/json' }, headers),
              body: JSON.stringify({ session_key: sessionKey })
            }).then(function (r) {
              return r.json().then(function (j) {
                if (!r.ok) throw new Error(j && j.message ? j.message : 'complete 실패');
                return j;
              });
            });
          }
          var start = index * chunkSize;
          var blob = file.slice(start, Math.min(start + chunkSize, file.size));
          var fd = new FormData();
          fd.append('session_key', sessionKey);
          fd.append('index', String(index));
          fd.append('chunk', blob, 'chunk');
          return fetch(VIDEO_CHUNK, { method: 'POST', headers: headers, body: fd })
            .then(function (r) {
              return r.json().then(function (j) {
                if (!r.ok) throw new Error(j && j.message ? j.message : 'chunk ' + index + ' 실패');
                if (onProgress) onProgress((index + 1) / count);
                return sendChunk(index + 1);
              });
            });
        };
        return sendChunk(0);
      });
  }

