/**
 * C1 임시 저장(1.7.0) 키·정리 규칙 — dist/js/write.js 의 순수 함수(core.ns('draft')). DOM 없이 돈다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadChunk } from './harness.mjs';

const { ns, sections } = loadChunk('write');
const d = ns('draft');
const DAY = 24 * 60 * 60 * 1000;

test('섹션 등록: 편집기 섹션 + 편집기 스캔 끝(제출 성공 감지)', () => {
  const s = sections.find((x) => x.name === 'write-draft');
  assert.equal(s.scope, 'editor');
  assert.equal(s.load, 'chunk');
  assert.equal(typeof s.editor, 'function');
  assert.equal(typeof s.editorEnd, 'function');
});

test('상수: 7일·500KB·10개', () => {
  assert.equal(d.MAX_AGE_MS, 7 * DAY);
  assert.equal(d.MAX_BYTES, 500 * 1024);
  assert.equal(d.MAX_DRAFTS, 10);
});

test('draftKey: 새 글·수정·답글, 글쓰기 경로가 아니면 null', () => {
  assert.equal(d.draftKey('u1', '/board/free/write', ''), 'g7sp:draft:v1:u1:free:new');
  assert.equal(d.draftKey('u1', '/board/free/write/', '?parent_id=12'), 'g7sp:draft:v1:u1:free:new:p12');
  assert.equal(d.draftKey('u1', '/board/free/34/edit', ''), 'g7sp:draft:v1:u1:free:34');
  assert.equal(d.draftKey('u1', '/board/free/34', ''), null);
  assert.equal(d.draftKey('u1', '/page/about', ''), null);
  assert.equal(d.draftKey('', '/board/free/write', ''), null);
  assert.equal(d.draftKey('bad user!', '/board/free/write', ''), null);
  // 부모 id 의 이상한 글자는 버린다
  assert.equal(d.draftKey('u1', '/board/free/write', '?x=1&parent_id=1%3Cb%3E'), 'g7sp:draft:v1:u1:free:new:p1b');
});

test('pruneKeys: 만료·깨진 값(모든 사용자) + 이 사용자 최신 keep 개 초과', () => {
  const now = 100 * DAY;
  const entries = [
    { key: 'g7sp:draft:v1:u1:a:new', t: now - 1 },
    { key: 'g7sp:draft:v1:u1:b:new', t: now - 2 },
    { key: 'g7sp:draft:v1:u1:c:new', t: now - 3 },
    { key: 'g7sp:draft:v1:u1:old:new', t: now - 8 * DAY },
    { key: 'g7sp:draft:v1:u2:x:new', t: now - 8 * DAY },
    { key: 'g7sp:draft:v1:u2:y:new', t: now - 5 },
    { key: 'g7sp:draft:v1:u1:broken', t: null },
  ];
  const del = [...d.pruneKeys(entries, now, 'u1', 2)].sort();
  assert.deepEqual(del, [
    'g7sp:draft:v1:u1:broken',
    'g7sp:draft:v1:u1:c:new',
    'g7sp:draft:v1:u1:old:new',
    'g7sp:draft:v1:u2:x:new',
  ].sort());
});

test('pruneKeys: 다른 사용자의 개수는 세지 않는다', () => {
  const now = 10 * DAY;
  const entries = Array.from({ length: 12 }, (_, i) => ({ key: 'g7sp:draft:v1:u2:k' + i + ':new', t: now - i }));
  assert.deepEqual([...d.pruneKeys(entries, now, 'u1', 9)], []);
});

test('byteLength: UTF-8 바이트', () => {
  assert.equal(d.byteLength('abc'), 3);
  assert.equal(d.byteLength('가'), 3);
  assert.equal(d.byteLength('😀'), 4);
});

test('userKey: uuid 를 그대로 쓰지 않는 짧은 해시, 키 형식에 맞음, 없으면 빈 값', () => {
  const k = d.userKey('8f6a1c2e-0000-4000-8000-123456789abc');
  assert.match(k, /^u[0-9a-z]+$/);
  assert.equal(k.includes('8f6a1c2e'), false);
  assert.equal(d.userKey('8f6a1c2e-0000-4000-8000-123456789abc'), k);
  assert.notEqual(d.userKey('other'), k);
  assert.equal(d.userKey(''), '');
  assert.equal(d.userKey(null), '');
  assert.ok(d.draftKey(k, '/board/free/write', '').startsWith('g7sp:draft:v1:' + k + ':'));
});

test('fingerprint: 같은 내용은 같고 다르면 다르다', () => {
  assert.equal(d.fingerprint('<p>a</p>'), d.fingerprint('<p>a</p>'));
  assert.notEqual(d.fingerprint('<p>a</p>'), d.fingerprint('<p>b</p>'));
  assert.equal(typeof d.fingerprint(''), 'string');
});
