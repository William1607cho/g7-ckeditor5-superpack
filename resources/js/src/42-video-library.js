  var VIDEO_META = '/api/plugins/' + IDENTIFIER + '/video/meta';

  /** 편집기 컨테이너 하나에 업로드 바 + 미디어 라이브러리를 붙인다 (중복 방지). */
  function attachUploaderTo(container) {
    if (container.__ck5spVideo) return;
    var cfg = readSettings();
    if (!cfg.videoEnabled) return;
    container.__ck5spVideo = true;
    injectUploadStyle();

    var exts = allowedVideoExts(cfg);
    var MIME = { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' }; // 허용 확장자에 맞는 MIME 만
    var accept = exts.map(function (x) { return '.' + x; }).concat(exts.map(function (x) { return MIME[x]; }).filter(Boolean)).join(',');

    var bar = document.createElement('div');
    bar.className = 'ck5sp-vbar';
    bar.innerHTML =
      '<button type="button" class="ck5sp-vbar__btn">' + esc(t('editor.video.button', '동영상 업로드')) + '</button>'
      + '<span class="ck5sp-vbar__hint">' + esc(t('editor.video.hint', '{exts} · 최대 {max}MB').replace('{exts}', exts.map(function (x) { return x.toUpperCase(); }).join('/')).replace('{max}', String(cfg.videoMaxMb))) + '</span>'
      + '<span class="ck5sp-vbar__prog"><span></span></span>'
      + '<span class="ck5sp-vbar__msg"></span>'
      + '<input type="file" accept="' + accept + '" hidden>';
    container.parentNode.insertBefore(bar, container);

    var btn = bar.querySelector('.ck5sp-vbar__btn');
    var input = bar.querySelector('input[type=file]');
    var prog = bar.querySelector('.ck5sp-vbar__prog');
    var progFill = prog.firstElementChild;
    var msg = bar.querySelector('.ck5sp-vbar__msg');

    // ---- 미디어 라이브러리 ----
    var lib = document.createElement('div');
    lib.className = 'ck5sp-vlib';
    lib.hidden = true;
    lib.innerHTML = '<div class="ck5sp-vlib__head">' + esc(t('editor.video.library', '동영상 라이브러리')) + '</div><div class="ck5sp-vlib__list"></div>';
    var libList = lib.querySelector('.ck5sp-vlib__list');
    container.parentNode.insertBefore(lib, container);

    var libIndex = {}; // videoId -> card element

    function currentEditor() { return editorInstanceNear(container); }

    /** 라이브러리 카드 추가 (동영상 id 기준 중복 제거). */
    function addLibCard(url, name, mime) {
      var id = videoIdOf(url);
      if (!id || libIndex[id]) return;
      lib.hidden = false;

      var card = document.createElement('div');
      card.className = 'ck5sp-vlib__card';
      card.setAttribute('data-vid', id);
      var baseUrl = videoUrlWithSize(url, 'md'); // 파라미터 제거된 순수 URL

      var v = document.createElement('video');
      v.controls = true; v.preload = 'metadata'; v.playsInline = true; v.src = baseUrl;
      card.appendChild(v);

      var nameEl = document.createElement('div');
      nameEl.className = 'ck5sp-vlib__name';
      nameEl.textContent = name || id;
      nameEl.title = name || id;
      card.appendChild(nameEl);

      var row = document.createElement('div');
      row.className = 'ck5sp-vlib__row';
      var size = 'md';
      ['sm', 'md', 'lg'].forEach(function (s) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'ck5sp-vlib__sz' + (s === size ? ' is-on' : '');
        b.textContent = t('editor.video.size_' + s, s === 'sm' ? '소' : (s === 'lg' ? '대' : '중'));
        b.addEventListener('click', function (ev) {
          ev.stopPropagation();
          size = s;
          row.querySelectorAll('.ck5sp-vlib__sz').forEach(function (x) { x.classList.remove('is-on'); });
          b.classList.add('is-on');
        });
        row.appendChild(b);
      });
      var ins = document.createElement('button');
      ins.type = 'button';
      ins.className = 'ck5sp-vlib__ins';
      ins.textContent = t('editor.video.insert', '본문에 삽입');
      var doInsert = function () {
        var ed = currentEditor();
        if (!ed) { msg.style.color = ''; msg.textContent = t('editor.video.err_editor', '에디터를 찾지 못했습니다. 잠시 후 다시 시도하세요.'); return; }
        insertVideoLink(ed, baseUrl, name || id, size);
      };
      ins.addEventListener('click', function (ev) { ev.stopPropagation(); doInsert(); });
      row.appendChild(ins);
      card.appendChild(row);

      libIndex[id] = card;
      libList.appendChild(card);
    }

    /** 에디터 본문(getData)에 이미 들어 있는 동영상들을 라이브러리에 채운다 (수정 화면 대응). */
    function hydrateFromEditor() {
      var ed = currentEditor();
      if (!ed) return;
      var data = '';
      try { data = ed.getData() || ''; } catch (e) { return; }
      var ids = [], m, re = /\/api\/plugins\/g7-ckeditor5-superpack\/video\/([a-f0-9]{32})\b/gi;
      while ((m = re.exec(data)) !== null) {
        var id = m[1].toLowerCase();
        if (ids.indexOf(id) === -1 && !libIndex[id]) ids.push(id);
      }
      if (!ids.length) return;
      var token = authToken();
      fetch(VIDEO_META, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json', Accept: 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
        body: JSON.stringify({ ids: ids })
      })
        .then(function (r) { return r.ok ? r.json() : []; })
        .then(function (list) {
          (Array.isArray(list) ? list : []).forEach(function (it) {
            if (it && it.url) addLibCard(it.url, it.name || '', it.mime || '');
          });
        })
        .catch(function () {});
    }
    // 편집기 콘텐츠가 늦게 세팅될 수 있어 몇 차례 시도
    [200, 800, 2000].forEach(function (ms) { window.setTimeout(hydrateFromEditor, ms); });

    btn.addEventListener('click', function () { msg.textContent = ''; input.click(); });

    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      var c = readSettings();
      var ext = (file.name.split('.').pop() || '').toLowerCase();
      if (allowedVideoExts(c).indexOf(ext) === -1) { msg.style.color = ''; msg.textContent = t('editor.video.err_ext', 'MP4 파일만 업로드할 수 있습니다.'); return; }
      if (file.size > c.videoMaxMb * 1024 * 1024) {
        msg.style.color = '';
        msg.textContent = t('editor.video.err_size', '파일이 너무 큽니다 (최대 {max}MB).').replace('{max}', String(c.videoMaxMb)).replace('{cur}', humanMb(file.size));
        return;
      }
      var editor = currentEditor();
      if (!editor) { msg.style.color = ''; msg.textContent = t('editor.video.err_editor', '에디터를 찾지 못했습니다. 잠시 후 다시 시도하세요.'); return; }

      btn.disabled = true;
      prog.style.display = 'block';
      progFill.style.width = '0%';
      var origLabel = btn.textContent;
      btn.textContent = t('editor.video.uploading', '업로드 중…');

      chunkedUpload(file, c, function (p) { progFill.style.width = Math.round(p * 100) + '%'; })
        .then(function (r) {
          var nm = r.name || file.name;
          addLibCard(r.url, nm, r.mime || file.type || '');
          insertVideoLink(editor, r.url, nm, 'md'); // 업로드 시 1회 자동 삽입 (기존 UX 유지)
          msg.style.color = '';
          msg.textContent = t('editor.video.done', '삽입되었습니다. 저장하면 게시글에서 재생됩니다.');
          window.setTimeout(function () { if (msg && msg.textContent === t('editor.video.done', '삽입되었습니다. 저장하면 게시글에서 재생됩니다.')) msg.textContent = ''; }, 6000);
        })
        .catch(function (e) {
          msg.style.color = '';
          msg.textContent = (e && e.message) ? e.message : t('editor.video.err_generic', '업로드에 실패했습니다.');
        })
        .then(function () {
          btn.disabled = false;
          btn.textContent = origLabel;
          prog.style.display = 'none';
        });
    });
  }

