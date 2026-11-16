/**
 * 1.7.1: CKEditor 「Powered by」 배지 판정(코어 한 곳)과 글자 수 줄의 여백. DOM 없이 돈다(harness.mjs).
 * 실행: node --test tests/js/*.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGlobal, loadChunk } from './harness.mjs';

/** CKEditor 인스턴스 흉내: ui.poweredBy 유무와 config 값만 */
function fakeEditor({ poweredBy = true, license, ui } = {}) {
  const conf = { licenseKey: license, 'ui.poweredBy': ui };
  return {
    ui: poweredBy ? { poweredBy: {} } : {},
    config: { get: (k) => conf[k] },
  };
}

test('badgeHangsBelow: 배지 기능이 없으면 false', () => {
  const { core } = loadGlobal();
  assert.equal(core.badgeHangsBelow(null), false);
  assert.equal(core.badgeHangsBelow({}), false);
  assert.equal(core.badgeHangsBelow({ hasPoweredBy: false, licenseKey: null }), false);
});

test('badgeHangsBelow: 키 없음·빈 키·GPL 은 배지가 뜬다(기본 위치 border)', () => {
  const { core } = loadGlobal();
  assert.equal(core.badgeHangsBelow({ hasPoweredBy: true, licenseKey: null }), true);
  assert.equal(core.badgeHangsBelow({ hasPoweredBy: true, licenseKey: undefined }), true);
  assert.equal(core.badgeHangsBelow({ hasPoweredBy: true, licenseKey: '' }), true);
  assert.equal(core.badgeHangsBelow({ hasPoweredBy: true, licenseKey: 'GPL' }), true);
  assert.equal(core.badgeHangsBelow({ hasPoweredBy: true, licenseKey: 'GPL', position: 'border' }), true);
});

test('badgeHangsBelow: 유료 키는 배지 없음, forceVisible 이면 키와 상관없이 뜬다', () => {
  const { core } = loadGlobal();
  assert.equal(core.badgeHangsBelow({ hasPoweredBy: true, licenseKey: 'abc.def' }), false);
  assert.equal(core.badgeHangsBelow({ hasPoweredBy: true, licenseKey: 'abc.def', forceVisible: true }), true);
});

test('badgeHangsBelow: 위치 inside 는 편집 영역 안이라 아래 표시와 겹치지 않는다', () => {
  const { core } = loadGlobal();
  assert.equal(core.badgeHangsBelow({ hasPoweredBy: true, licenseKey: null, position: 'inside' }), false);
  assert.equal(core.badgeHangsBelow({ hasPoweredBy: true, licenseKey: null, position: 'inside', forceVisible: true }), false);
});

test('poweredByBadgeBelow: 에디터 인스턴스에서 재료를 읽는다', () => {
  const { core } = loadGlobal();
  assert.equal(core.poweredByBadgeBelow(fakeEditor()), true); // sirsoft 1.1.x: 키 없음
  assert.equal(core.poweredByBadgeBelow(fakeEditor({ license: 'GPL' })), true);
  assert.equal(core.poweredByBadgeBelow(fakeEditor({ license: 'commercial-key' })), false);
  assert.equal(core.poweredByBadgeBelow(fakeEditor({ poweredBy: false })), false); // 배지 기능 없는 판
  assert.equal(core.poweredByBadgeBelow(fakeEditor({ ui: { position: 'inside' } })), false);
  assert.equal(core.poweredByBadgeBelow(fakeEditor({ license: 'x', ui: { forceVisible: true } })), true);
  assert.equal(core.poweredByBadgeBelow(null), false);
  assert.equal(core.poweredByBadgeBelow({ ui: { poweredBy: {} } }), false); // config 없음
  const throwing = { ui: { poweredBy: {} }, config: { get() { throw new Error('x'); } } };
  assert.equal(core.poweredByBadgeBelow(throwing), true); // 읽기 실패 = 기본값(키 없음·border)
});

/** 글자 수 줄을 붙일 가짜 컨테이너. 붙은 줄을 돌려준다. */
function attachCount(extraCore) {
  const editor = {
    model: {
      document: { getRoot: () => ({}), on() {} },
      createRangeIn: () => ({ getItems: () => ({ next: () => ({ done: true }) }) }),
    },
    plugins: { has: () => false },
  };
  const inserted = [];
  const container = {
    nextElementSibling: null,
    nextSibling: null,
    parentNode: { insertBefore(el) { inserted.push(el); } },
  };
  const { sections, win } = loadChunk('write', Object.assign({
    readSettings: () => ({ writeCount: true }),
    writeWanted: () => true,
    editorInstanceNear: () => editor,
  }, extraCore));
  sections.find((s) => s.name === 'write-count').editor(container);
  return { line: inserted[0], editor, win };
}

test('글자 수 줄: 배지가 내려오면 --badge 클래스(여백), 아니면 기본 클래스', () => {
  let got = attachCount({ poweredByBadgeBelow: () => true });
  assert.equal(got.line.className, 'ck5sp-count ck5sp-count--badge');
  got = attachCount({ poweredByBadgeBelow: () => false });
  assert.equal(got.line.className, 'ck5sp-count');
});

test('글자 수 줄: 판정에 에디터 인스턴스를 넘긴다', () => {
  let seen = null;
  const got = attachCount({ poweredByBadgeBelow: (ed) => { seen = ed; return false; } });
  assert.equal(seen, got.editor);
});

test('글자 수 줄: 옛 전역 스크립트(판정 함수 없음)·판정 예외는 기본 클래스', () => {
  let got = attachCount({});
  assert.equal(got.line.className, 'ck5sp-count');
  got = attachCount({ poweredByBadgeBelow: () => { throw new Error('x'); } });
  assert.equal(got.line.className, 'ck5sp-count');
});

test('글자 수 스타일: 기본 여백은 그대로, --badge 여백 14px(배지 절반 8px + 간격 6px)', () => {
  // 스타일 문자열만 확인한다(실제 겹침 여부는 스테이징 헤드리스 측정).
  const { win } = attachCount({ poweredByBadgeBelow: () => true });
  const src = win.document.head.children.map((c) => c.textContent).join('');
  assert.ok(src.includes('.ck5sp-count{margin-top:.35em;'));
  assert.ok(src.includes('.ck5sp-count.ck5sp-count--badge{margin-top:14px;}'));
});
