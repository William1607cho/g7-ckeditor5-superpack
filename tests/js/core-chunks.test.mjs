/**
 * 코어(1.7.0): 경로 판별·지연 로드 묶음 주소·공용 관찰자 폴백. DOM 없이 돈다(harness.mjs).
 * 실행: node --test tests/js/*.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGlobal } from './harness.mjs';

test('routeKind: 글 상세·글쓰기·수정·그 밖', () => {
  const { core } = loadGlobal();
  assert.equal(core.routeKind('/board/free/12'), 'detail');
  assert.equal(core.routeKind('/board/free/hello-world/'), 'detail');
  assert.equal(core.routeKind('/board/free/write'), 'write');
  assert.equal(core.routeKind('/board/free/12/edit'), 'write');
  assert.equal(core.routeKind('/board/free'), '');
  assert.equal(core.routeKind('/board/free/12/other'), '');
  assert.equal(core.routeKind('/page/about'), '');
  assert.equal(core.routeKind('/'), '');
  assert.equal(core.routeKind('/admin/board/free/12'), '');
});

test('chunkUrl: 확장자 모드와 확장자 없는 모드, cache_version', () => {
  let { core } = loadGlobal({ config: { cache_version: 42 } });
  assert.equal(core.chunkUrl('view'), '/api/plugins/assets/g7-ckeditor5-superpack/dist/js/view.js?v=42');
  ({ core } = loadGlobal({ config: { cache_version: 42, assetUrlMode: 'extensionless' } }));
  assert.equal(core.chunkUrl('write'), '/api/plugins/assets/g7-ckeditor5-superpack?file=dist%2Fjs%2Fwrite.js&v=42');
});

test('isPostEditorEl: sirsoft 1.1 id 컨테이너·1.0 클래스는 본문 에디터, 댓글 에디터 안은 아님', () => {
  const { core } = loadGlobal();
  const mk = (matches) => ({ closest: (sel) => (matches.some((m) => sel.split(',').map((s) => s.trim()).includes(m)) ? {} : null) });
  assert.equal(core.isPostEditorEl(mk(['div[id^="ckeditor5-"]'])), true);
  assert.equal(core.isPostEditorEl(mk(['.ckeditor5-wrapper'])), true);
  assert.equal(core.isPostEditorEl(mk(['div[id^="ckeditor5-"]', '.g7ce-wrapper'])), false);
  assert.equal(core.isPostEditorEl(mk([])), false);
  assert.equal(core.isPostEditorEl(null), false);
});

test('whenVisible: IntersectionObserver 가 없으면 바로 부른다', () => {
  const { core } = loadGlobal();
  const el = { isConnected: true };
  let called = 0;
  core.whenVisible(el, (x) => { assert.equal(x, el); called++; });
  assert.equal(called, 1);
});

test('글 보기 설정은 기본 꺼짐', () => {
  const { core } = loadGlobal();
  const cfg = core.readSettings();
  assert.equal(cfg.viewToc, false);
  assert.equal(cfg.viewLightbox, false);
  assert.equal(cfg.viewFold, false);
  assert.equal(cfg.viewReadTime, false);
});

test('글 보기 설정 켜짐 읽기', () => {
  const { core } = loadGlobal({ settings: { view_toc_enabled: true, view_fold_enabled: '1' } });
  const cfg = core.readSettings();
  assert.equal(cfg.viewToc, true);
  assert.equal(cfg.viewFold, true);
  assert.equal(cfg.viewLightbox, false);
});
