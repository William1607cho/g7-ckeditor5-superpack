/**
 * B3 접기/펼치기(1.7.0) 표식 해석·짝 맞추기 — dist/js/view.js 의 순수 함수(core.ns('fold')). DOM 없이 돈다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadChunk } from './harness.mjs';

const { ns, sections } = loadChunk('view');
const fold = ns('fold');
const parse = (s) => {
  const r = fold.parseMarker(s);
  return r === null ? null : { ...r };
};
const pairs = (k) => JSON.parse(JSON.stringify(fold.pairMarkers(k)));

test('섹션 등록: 목차·읽는 시간보다 먼저(order 100)', () => {
  const s = sections.find((x) => x.name === 'view-fold');
  assert.equal(s.order, 100);
  assert.equal(s.load, 'chunk');
  assert.equal(s.gate({ viewFold: false }), false);
  assert.ok(s.order < sections.find((x) => x.name === 'view-toc').order);
});

test('여는 표식: 제목 있음·없음·공백 변형', () => {
  assert.deepEqual(parse('[접기] 자세한 설명'), { type: 'open', title: '자세한 설명' });
  assert.deepEqual(parse('  [접기]   제목  여러칸  '), { type: 'open', title: '제목 여러칸' });
  assert.deepEqual(parse('[접기]'), { type: 'open', title: '' });
  assert.deepEqual(parse('[접기] 제목'), { type: 'open', title: '제목' });
});

test('닫는 표식', () => {
  assert.deepEqual(parse('[/접기]'), { type: 'close' });
  assert.deepEqual(parse('  [/접기] '), { type: 'close' });
});

test('표식이 아닌 것', () => {
  assert.equal(parse('[접기]제목'), null); // 표식 뒤 공백 필요
  assert.equal(parse('이 글은 [접기] 를 설명합니다'), null);
  assert.equal(parse('[/접기] 뒤에 글'), null);
  assert.equal(parse('[펼치기] 제목'), null);
  assert.equal(parse(''), null);
  assert.equal(parse(null), null);
});

test('짝 맞추기: 순서대로, 겹치지 않음, 닫히지 않은 여는 줄·짝 없는 닫는 줄은 버림', () => {
  assert.deepEqual(pairs(['open', null, 'close']), [[0, 2]]);
  assert.deepEqual(pairs(['open', 'close', null, 'open', null, null, 'close']), [[0, 1], [3, 6]]);
  assert.deepEqual(pairs(['close', 'open', null]), []);
  assert.deepEqual(pairs(['open', 'open', 'close', 'close']), [[0, 2]]); // 안쪽 [접기] 는 글자로
  assert.deepEqual(pairs([null, null]), []);
  assert.deepEqual(pairs([]), []);
});
