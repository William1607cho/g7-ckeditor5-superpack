/**
 * B4 읽는 시간(1.7.0) 계산 — dist/js/view.js 의 순수 함수(core.ns('readtime')). DOM 없이 돈다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadChunk } from './harness.mjs';

const { ns, sections } = loadChunk('view');
const rt = ns('readtime');

test('섹션 등록: 지연 묶음, 기본 꺼짐 게이트', () => {
  const s = sections.find((x) => x.name === 'view-readtime');
  assert.ok(s);
  assert.equal(s.load, 'chunk');
  assert.equal(s.gate({ viewReadTime: false }), false);
  assert.equal(s.gate({ viewReadTime: true }), true);
});

// vm 안에서 만든 객체는 프로토타입이 달라 그대로 비교하면 실패한다 — 복사해 비교한다
const count = (s) => ({ ...rt.countText(s) });

test('countText: 한글 글자와 라틴 단어를 따로 센다', () => {
  assert.deepEqual(count('안녕하세요 세계'), { cjk: 7, words: 0 });
  assert.deepEqual(count('Hello world, it’s fine'), { cjk: 0, words: 4 });
  assert.deepEqual(count('한글 English 섞임 2026년'), { cjk: 5, words: 2 });
  assert.deepEqual(count(''), { cjk: 0, words: 0 });
  assert.deepEqual(count(null), { cjk: 0, words: 0 });
  assert.deepEqual(count('日本語とカタカナ'), { cjk: 8, words: 0 });
});

test('estimateMinutes: 500자/분, 200단어/분, 이미지 6초(최대 60초), 올림·최소 1', () => {
  assert.equal(rt.estimateMinutes({ cjk: 0, words: 0 }, 0), 0);
  assert.equal(rt.estimateMinutes({ cjk: 10, words: 0 }, 0), 1);
  assert.equal(rt.estimateMinutes({ cjk: 500, words: 0 }, 0), 1);
  assert.equal(rt.estimateMinutes({ cjk: 501, words: 0 }, 0), 2);
  assert.equal(rt.estimateMinutes({ cjk: 2500, words: 0 }, 0), 5);
  assert.equal(rt.estimateMinutes({ cjk: 0, words: 400 }, 0), 2);
  assert.equal(rt.estimateMinutes({ cjk: 1000, words: 200 }, 0), 3);
  assert.equal(rt.estimateMinutes({ cjk: 0, words: 0 }, 3), 1);
  // 이미지는 60초까지만
  assert.equal(rt.estimateMinutes({ cjk: 500, words: 0 }, 50), 2);
  assert.equal(rt.estimateMinutes({ cjk: -5, words: 'x' }, -1), 0);
});

test('label: 번역이 없으면 "약 N분"', () => {
  assert.equal(rt.label(3), '약 3분');
});
