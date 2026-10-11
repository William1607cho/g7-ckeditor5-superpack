/**
 * 업로드 중 제출 버튼 상태 전환(51-upload-guards) — 버튼 안의 React 관리 노드를 건드리지 않는다.
 *
 * 아이콘 전용 저장 버튼(`<button title="등록"><i class="fas fa-save"></i></button>`)에서 업로드 중 문구를
 * 바꾸려고 버튼 textContent 를 덮어쓰면 아이콘 `<i>` 가 DOM 에서 떨어져 나가고, 저장 때 템플릿 렌더러(React)가
 * 그 아이콘을 바꾸려다 removeChild 예외("컴포넌트 로드 실패 [Icon]")를 냈다. 배포 JS(dist/js/plugin.iife.js)를
 * 가짜 CKEditor 위에서 그대로 실행해 확인한다.
 *
 * 실행: node --test tests/js/*.test.mjs
 *   DOM 은 happy-dom 을 쓴다. 이 저장소에는 npm 의존성이 없으므로, happy-dom 이 설치된 폴더를
 *   HAPPY_DOM_FROM=<그 폴더>/package.json 으로 알려 준다(예: g7-wc-community 저장소에서 npm ci 한 뒤 그 폴더).
 *   찾지 못하면 이 테스트는 건너뛴다(사유 출력). 네트워크를 쓰지 않는다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const bundle = fs.readFileSync(path.join(root, 'dist/js/plugin.iife.js'), 'utf8');

let Window = null;
try {
  const req = createRequire(process.env.HAPPY_DOM_FROM || path.join(root, 'package.json'));
  ({ Window } = req('happy-dom'));
} catch (e) {
  Window = null;
}
const skip = Window ? false : 'happy-dom 을 찾지 못함 — HAPPY_DOM_FROM=<happy-dom 이 설치된 폴더>/package.json';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function emitter() {
  const handlers = {};
  return {
    on(name, fn) { (handlers[name] = handlers[name] || []).push(fn); },
    off(name, fn) { handlers[name] = (handlers[name] || []).filter((f) => f !== fn); },
    fire(name, ...args) { (handlers[name] || []).forEach((f) => f({}, ...args)); },
  };
}

/** 글쓰기 폼 + 가짜 편집기를 만들고 배포 JS 를 실행한다. */
async function boot(buttonsHtml) {
  const win = new Window({ url: 'https://example.test/board/qna/write' });
  const doc = win.document;
  doc.body.innerHTML = '<div id="form">'
    + '<div class="ckeditor5-wrapper"><div class="ck-editor"><div class="ck-editor__editable ck-content"></div></div></div>'
    + buttonsHtml
    + '</div>';
  const editable = doc.querySelector('.ck-editor__editable');
  const pending = Object.assign(emitter(), { hasAny: false });
  const editor = {
    plugins: {
      get(name) {
        if (name === 'PendingActions') return pending;
        if (name === 'FileRepository') return { loaders: emitter(), destroyLoader() {} };
        throw new Error('plugin not available: ' + name);
      },
    },
    editing: { view: { getDomRoot: () => editable } },
    model: { document: { getRoot: () => null } },
    execute() {},
  };
  editable.ckeditorInstance = editor;
  win.G7Config = { plugins: { 'g7-ckeditor5-superpack': { imagepaste_enabled: true } } };
  win.console = { log() {}, info() {}, debug() {}, warn() {}, error() {} };

  win.eval(bundle);
  await sleep(1300); // 부팅 킥(rAF·400ms·900ms)과 편집기 스캔(250ms 창)이 끝날 때까지

  const setPending = (v) => { pending.hasAny = v; pending.fire('change:hasAny', 'hasAny', v); };
  return { win, doc, setPending };
}

test('아이콘 전용 저장 버튼: 업로드 중·후 아이콘 노드가 그대로 붙어 있고 툴팁이 유지된다', { skip }, async () => {
  const { win, doc, setPending } = await boot(
    '<button type="button" data-testid="form-cancel" title="취소" aria-label="취소"><i class="fas fa-xmark"></i></button>'
    + '<button type="button" data-testid="form-save" title="등록" aria-label="등록"><i class="fas fa-save" aria-hidden="true"></i></button>',
  );
  const btn = doc.querySelector('[data-testid=form-save]');
  const icon = btn.querySelector('i');

  setPending(true);
  assert.equal(btn.disabled, true, '업로드 중에는 비활성(가드가 버튼에 붙었는지 확인)');
  assert.equal(btn.getAttribute('aria-busy'), 'true');
  assert.equal(icon.parentNode, btn, '업로드 중에도 아이콘 노드가 버튼에 붙어 있다');
  assert.equal(btn.childNodes.length, 1, '버튼 자식이 바뀌지 않는다');
  assert.equal(btn.getAttribute('title'), '등록');
  assert.equal(btn.getAttribute('aria-label'), '등록');

  setPending(false);
  assert.equal(btn.disabled, false);
  assert.equal(btn.getAttribute('aria-busy'), null);
  assert.equal(btn.firstElementChild, icon, '업로드가 끝난 뒤에도 같은 아이콘 노드');
  assert.equal(btn.childNodes.length, 1);
  assert.equal(icon.className, 'fas fa-save');
  win.happyDOM.abort();
  win.close();
});

test('문구 span 이 있는 버튼: 업로드 중 문구를 바꾸고 끝나면 원래 문구로 되돌린다', { skip }, async () => {
  const { win, doc, setPending } = await boot(
    '<button type="button" id="submit"><i class="fas fa-check"></i><span>글 작성 완료</span></button>',
  );
  const btn = doc.querySelector('#submit');
  const icon = btn.querySelector('i');
  const span = btn.querySelector('span');

  setPending(true);
  assert.equal(btn.disabled, true);
  assert.notEqual(span.textContent, '글 작성 완료', '업로드 중 문구');
  assert.equal(icon.parentNode, btn);

  setPending(false);
  assert.equal(span.textContent, '글 작성 완료');
  assert.equal(btn.disabled, false);
  assert.equal(icon.parentNode, btn);
  win.happyDOM.abort();
  win.close();
});
