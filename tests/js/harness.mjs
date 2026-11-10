/**
 * DOM 없이 배포 JS 를 node vm 에서 돌리는 작은 하네스 (1.7.0).
 *
 * 순수 계산(경로 판별·읽는 시간·접기 표식 해석 등)만 시험한다. 실제 DOM 동작은 happy-dom 시험
 * (upload-guards.test.mjs)과 스테이징 헤드리스 확인이 맡는다. 네트워크를 쓰지 않는다.
 *
 *   const { core, win } = loadGlobal({ path: '/board/free/12', settings: {...} });
 *   const viewCore = loadChunk('view', core-from-global);
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function fakeEl(tag) {
  return {
    tagName: String(tag).toUpperCase(),
    children: [],
    style: {},
    attrs: {},
    textContent: '',
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k] ?? null; },
    appendChild(c) { this.children.push(c); return c; },
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
  };
}

/** 전역 번들을 가짜 문서에서 평가하고, 'view' 묶음 자리로 코어 객체를 받아 돌려준다. */
export function loadGlobal({ path: pathname = '/', settings = {}, config = {} } = {}) {
  const doc = {
    readyState: 'complete',
    head: fakeEl('head'),
    body: fakeEl('body'),
    documentElement: fakeEl('html'),
    createElement: fakeEl,
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
  };
  const noop = () => 0;
  const win = {
    document: doc,
    location: { pathname },
    G7Config: Object.assign({ plugins: { 'g7-ckeditor5-superpack': settings }, cache_version: 7 }, config),
    setTimeout: noop,
    clearTimeout: noop,
    setInterval: noop,
    clearInterval: noop,
    console,
    Promise,
    Object,
    JSON,
    Math,
    Date,
  };
  win.window = win;
  const ctx = vm.createContext(win);
  vm.runInContext(fs.readFileSync(path.join(root, 'dist/js/plugin.iife.js'), 'utf8'), ctx);
  let core = null;
  win.__G7Ckeditor5Superpack.chunk('view', (c) => { core = c; });
  return { core, win, ctx };
}

/**
 * 묶음 파일(view|write)을 가짜 코어로 평가한다. 등록된 섹션과 ns 를 돌려준다.
 * extraCore 로 코어 도우미를 더 넣을 수 있다.
 */
export function loadChunk(name, extraCore = {}) {
  const sections = [];
  const namespaces = {};
  const fake = Object.assign({
    id: 'g7-ckeditor5-superpack',
    section(spec) { sections.push(spec); },
    ns(n) { return namespaces[n] || (namespaces[n] = {}); },
    t(_k, fb) { return fb; },
    esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); },
    warnOnce() {},
    logger: { log() {}, warn() {}, error() {} },
    readSettings() { return {}; },
    whenVisible(el, fn) { fn(el); },
    findMainBody() { return null; },
    routeKind() { return ''; },
    editorConfig() {},
    editorConfigWait() {},
  }, extraCore);
  const win = {
    document: { createElement: fakeEl, getElementById() { return null; }, head: fakeEl('head'), body: fakeEl('body'), addEventListener() {} },
    location: { pathname: '/' },
    setTimeout: () => 0,
    clearTimeout: () => 0,
    console,
    Promise,
    Object,
    JSON,
    Math,
    Date,
  };
  win.window = win;
  win.__G7Ckeditor5Superpack = { chunk(n, f) { if (n === name) f(fake); } };
  const ctx = vm.createContext(win);
  vm.runInContext(fs.readFileSync(path.join(root, 'dist/js/' + name + '.js'), 'utf8'), ctx);
  return { sections, ns: (n) => namespaces[n] || {}, core: fake, win };
}
