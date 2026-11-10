/**
 * B1 목차(1.7.0) 모델 — dist/js/view.js 의 순수 함수(core.ns('toc').model). DOM 없이 돈다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadChunk } from './harness.mjs';

const { ns, sections } = loadChunk('view');
const toc = ns('toc');
const model = (heads, taken) => {
  const m = toc.model(heads, taken);
  return m === null ? null : JSON.parse(JSON.stringify(m));
};
const h = (level, text, id = '') => ({ level, text, id });

test('섹션 등록과 최소 제목 수 3', () => {
  const s = sections.find((x) => x.name === 'view-toc');
  assert.equal(s.load, 'chunk');
  assert.equal(s.gate({ viewToc: false }), false);
  assert.equal(toc.MIN_HEADINGS, 3);
});

test('제목이 3개 미만이면 null, 빈 제목은 세지 않는다', () => {
  assert.equal(model([h(2, '하나'), h(2, '둘')]), null);
  assert.equal(model([h(2, '하나'), h(2, '  '), h(3, '셋')]), null);
});

test('툴바 제목 h2~h4 → 단계 0~2, id 는 ck5-toc-순번', () => {
  const m = model([h(2, '가'), h(3, '나'), h(4, '다'), h(2, '라')]);
  assert.deepEqual(m.map((x) => x.depth), [0, 1, 2, 0]);
  assert.deepEqual(m.map((x) => x.id), ['ck5-toc-1', 'ck5-toc-2', 'ck5-toc-3', 'ck5-toc-4']);
});

test('마크다운 h1~h3 과 섞여도 쓰인 수준끼리 상대 단계', () => {
  const m = model([h(1, 'A'), h(3, 'B'), h(3, 'C')]);
  assert.deepEqual(m.map((x) => x.depth), [0, 1, 1]);
  const m2 = model([h(1, 'A'), h(2, 'B'), h(3, 'C'), h(4, 'D')]);
  assert.deepEqual(m2.map((x) => x.depth), [0, 1, 2, 2]);
});

test('공백 정리', () => {
  const m = model([h(2, '  제목\n  하나 '), h(2, '둘'), h(2, '셋')]);
  assert.equal(m[0].text, '제목 하나');
});

test('기존 id: 형식이 맞고 겹치지 않으면 유지, 아니면 순번', () => {
  const m = model([h(2, 'A', 'intro'), h(2, 'B', 'intro'), h(2, 'C', '1bad'), h(2, 'D', 'taken')], (id) => id === 'taken');
  assert.deepEqual(m.map((x) => [x.id, x.keepId]), [['intro', true], ['ck5-toc-2', false], ['ck5-toc-3', false], ['ck5-toc-4', false]]);
});

test('순번 id 가 문서의 다른 요소와 겹치면 비켜 간다', () => {
  const m = model([h(2, 'A'), h(2, 'B'), h(2, 'C')], (id) => id === 'ck5-toc-2');
  assert.deepEqual(m.map((x) => x.id), ['ck5-toc-1', 'ck5-toc-2-x', 'ck5-toc-3']);
});
