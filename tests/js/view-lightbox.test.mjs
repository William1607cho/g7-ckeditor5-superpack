/**
 * B2 라이트박스(1.7.0) 대상 판정 — dist/js/view.js 의 순수 함수(core.ns('lightbox')). DOM 없이 돈다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadChunk } from './harness.mjs';

const { ns, sections } = loadChunk('view');
const lb = ns('lightbox');
const ORIG = '/api/plugins/sirsoft-ckeditor5/images/0123456789ab';
const VAR960 = '/api/plugins/g7-image-delivery/variants/0123456789ab-960-a1b2c3d4.webp';
const VAR1600 = '/api/plugins/g7-image-delivery/variants/0123456789ab-1600-e5f6a7b8.webp';

test('섹션 등록', () => {
  const s = sections.find((x) => x.name === 'view-lightbox');
  assert.equal(s.load, 'chunk');
  assert.equal(s.gate({ viewLightbox: false }), false);
  assert.equal(s.gate({ viewLightbox: true }), true);
});

test('imageHash: 원본·변환본·절대 주소, 그 밖은 null', () => {
  assert.equal(lb.imageHash(ORIG), '0123456789ab');
  assert.equal(lb.imageHash('https://blog.example' + ORIG + '?x=1'), '0123456789ab');
  assert.equal(lb.imageHash(VAR960), '0123456789ab');
  assert.equal(lb.imageHash('/api/plugins/sirsoft-ckeditor5/images/0123456789abc'), null);
  assert.equal(lb.imageHash('https://example.com/a.png'), null);
  assert.equal(lb.imageHash(''), null);
  assert.equal(lb.imageHash(null), null);
});

test('largestFromSrcset: 가장 큰 w, x 표기, 빈 값', () => {
  assert.equal(lb.largestFromSrcset(VAR960 + ' 960w, ' + VAR1600 + ' 1600w'), VAR1600);
  assert.equal(lb.largestFromSrcset(VAR1600 + ' 1600w, ' + VAR960 + ' 960w'), VAR1600);
  assert.equal(lb.largestFromSrcset('a.png 1x, b.png 2x'), 'b.png');
  assert.equal(lb.largestFromSrcset('only.png'), 'only.png');
  assert.equal(lb.largestFromSrcset(''), null);
});

test('isZoomable: 링크 없음 / 자기 원본 링크만 대상', () => {
  assert.equal(lb.isZoomable(null, 'https://example.com/a.png', ''), true);
  assert.equal(lb.isZoomable(ORIG, VAR960, VAR960 + ' 960w, ' + VAR1600 + ' 1600w'), true);
  assert.equal(lb.isZoomable(ORIG, ORIG, ''), true);
  // 글쓴이가 다른 주소로 건 링크
  assert.equal(lb.isZoomable('https://example.com/page', VAR960, ''), false);
  // 다른 이미지의 원본 링크
  assert.equal(lb.isZoomable('/api/plugins/sirsoft-ckeditor5/images/ffffffffffff', VAR960, ''), false);
  // 링크가 변환본 주소(원본 아님)
  assert.equal(lb.isZoomable(VAR1600, VAR960, ''), false);
  // 외부 이미지가 원본 링크에 감싸인 이상한 경우
  assert.equal(lb.isZoomable(ORIG, 'https://example.com/a.png', ''), false);
});
