/**
 * 코드 서식(1.5.0) 결함 수정(1.7.0): 본문 에디터 판정이 코어 한 곳(isPostEditorEl)을 쓰는지.
 * sirsoft-ckeditor5 1.1 은 컨테이너에 `ckeditor5-wrapper` 클래스가 없고 `id="ckeditor5-<이름>"` 만 있다.
 * 전역 번들을 가짜 문서에서 돌리고, 가짜 ClassicEditor 를 window.CKEDITOR 에 넣어 create 감싸기를 통과시킨다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGlobal } from './harness.mjs';

/** closest(sel) 가 matches 의 선택자 중 하나가 sel 목록에 있으면 요소를 돌려주는 가짜 요소 */
const fakeEl = (matches) => ({ closest: (sel) => (matches.some((m) => sel.split(',').map((s) => s.trim()).includes(m)) ? {} : null) });

function boot() {
  const { core, win } = loadGlobal({ path: '/board/free/write' });
  const Code = { name: 'Code' };
  const CodeBlock = { name: 'CodeBlock' };
  const Classic = { create(el, cfg) { return cfg; } };
  win.CKEDITOR = { Code, CodeBlock }; // 대입 접근자가 감싸기를 건다
  win.CKEDITOR.ClassicEditor = Classic;
  return { core, win, Code, CodeBlock };
}

const baseCfg = () => ({ plugins: [], toolbar: { items: ['bold', 'strikethrough', 'blockQuote'] } });

test('postEditorCss: 두 컨테이너 형식마다 선택자를 만든다', () => {
  const { core } = loadGlobal();
  assert.equal(core.postEditorCss('.ck-editor__editable'), '.ckeditor5-wrapper .ck-editor__editable,div[id^="ckeditor5-"] .ck-editor__editable');
  assert.equal(core.postEditorCss('x', 'html.dark '), 'html.dark .ckeditor5-wrapper x,html.dark div[id^="ckeditor5-"] x');
});

test('sirsoft 1.1 id 컨테이너 안의 본문 에디터에 코드·코드 블록 버튼이 들어간다', () => {
  const { win, Code, CodeBlock } = boot();
  const out = win.CKEDITOR.ClassicEditor.create(fakeEl(['div[id^="ckeditor5-"]']), baseCfg());
  assert.ok(out.extraPlugins.includes(Code));
  assert.ok(out.extraPlugins.includes(CodeBlock));
  assert.deepEqual([...out.toolbar.items], ['bold', 'strikethrough', 'code', 'blockQuote', 'codeBlock']);
});

test('옛 클래스 컨테이너도 그대로 된다', () => {
  const { win, Code } = boot();
  const out = win.CKEDITOR.ClassicEditor.create(fakeEl(['.ckeditor5-wrapper']), baseCfg());
  assert.ok(out.extraPlugins.includes(Code));
});

test('댓글 에디터·바깥 요소는 건드리지 않는다', () => {
  const { win } = boot();
  const c1 = baseCfg();
  assert.equal(win.CKEDITOR.ClassicEditor.create(fakeEl(['.g7ce-wrapper']), c1), c1);
  const c2 = baseCfg();
  assert.equal(win.CKEDITOR.ClassicEditor.create(fakeEl(['div[id^="ckeditor5-"]', '.g7ce-wrapper']), c2), c2);
  const c3 = baseCfg();
  assert.equal(win.CKEDITOR.ClassicEditor.create(fakeEl([]), c3), c3);
});

test('글자 수 켜짐: 사용자 글쓰기 화면 본문 에디터에만 WordCount(로그인 상태를 아직 몰라도)', () => {
  const mk = (path, settings) => {
    const { win } = loadGlobal({ path, settings });
    const WordCount = { name: 'WordCount' };
    win.CKEDITOR = { Code: {}, CodeBlock: {}, WordCount };
    win.CKEDITOR.ClassicEditor = { create(el, cfg) { return cfg; } };
    return { win, WordCount };
  };
  let { win, WordCount } = mk('/board/free/write', { write_count_enabled: true });
  assert.ok(win.CKEDITOR.ClassicEditor.create(fakeEl(['div[id^="ckeditor5-"]']), baseCfg()).extraPlugins.includes(WordCount));
  assert.equal((win.CKEDITOR.ClassicEditor.create(fakeEl(['.g7ce-wrapper']), baseCfg()).extraPlugins || []).includes(WordCount), false);
  ({ win, WordCount } = mk('/board/free/write', { write_count_enabled: false }));
  assert.equal(win.CKEDITOR.ClassicEditor.create(fakeEl(['div[id^="ckeditor5-"]']), baseCfg()).extraPlugins.includes(WordCount), false);
  ({ win, WordCount } = mk('/admin/board/free/write', { write_count_enabled: true }));
  assert.equal(win.CKEDITOR.ClassicEditor.create(fakeEl(['div[id^="ckeditor5-"]']), baseCfg()).extraPlugins.includes(WordCount), false);
});

test('설정에서 끄면 버튼을 넣지 않는다', () => {
  const { core, win } = loadGlobal({ path: '/board/free/write', settings: { codeformat_enabled: false } });
  win.CKEDITOR = { Code: {}, CodeBlock: {} };
  win.CKEDITOR.ClassicEditor = { create(el, cfg) { return cfg; } };
  const c = baseCfg();
  assert.equal(win.CKEDITOR.ClassicEditor.create(fakeEl(['div[id^="ckeditor5-"]']), c), c);
  assert.ok(core);
});
