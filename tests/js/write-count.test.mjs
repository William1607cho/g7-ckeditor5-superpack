/**
 * C2 글자 수(1.7.0) 계산 — dist/js/write.js 의 순수 함수(core.ns('count')). DOM 없이 돈다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadChunk } from './harness.mjs';

const { ns, sections } = loadChunk('write');
const cnt = ns('count');
const c = (s) => ({ ...cnt.countChars(s) });

test('섹션 등록: 편집기 섹션, 지연 묶음', () => {
  const s = sections.find((x) => x.name === 'write-count');
  assert.equal(s.scope, 'editor');
  assert.equal(s.load, 'chunk');
  assert.equal(typeof s.editor, 'function');
});

test('countChars: 공백 포함·제외', () => {
  assert.deepEqual(c('안녕 하세요'), { withSpaces: 6, withoutSpaces: 5 });
  assert.deepEqual(c('a b\tc\nd'), { withSpaces: 7, withoutSpaces: 4 });
  assert.deepEqual(c(''), { withSpaces: 0, withoutSpaces: 0 });
  assert.deepEqual(c(null), { withSpaces: 0, withoutSpaces: 0 });
});

test('countChars: 이모지는 코드 포인트 단위(서로게이트 쌍을 둘로 세지 않음)', () => {
  assert.deepEqual(c('😀'), { withSpaces: 1, withoutSpaces: 1 });
  assert.deepEqual(c('가😀 나'), { withSpaces: 4, withoutSpaces: 3 });
});

test('label: 번역이 없으면 기본 문구', () => {
  assert.equal(cnt.label({ withSpaces: 1234, withoutSpaces: 1000 }).startsWith('글자 '), true);
  assert.ok(cnt.label({ withSpaces: 5, withoutSpaces: 4 }).includes('공백 제외 4'));
});
