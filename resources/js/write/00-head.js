/**
 * g7-ckeditor5-superpack — 글쓰기 도우미 묶음 (1.7.0, 지연 로드: dist/js/write.js)
 *
 * 관리자 설정 "글쓰기 도우미" 탭의 기능(임시 저장·글자 수) 중 하나라도 켜져 있고, 로그인한 사용자가
 * 사용자 글쓰기·수정 화면(`/board/<slug>/write`, `/board/<slug>/<id>/edit`)에 있을 때만 불러온다.
 * 대상은 게시글 본문 에디터(코어 `isPostEditorEl`)뿐이다. 댓글 에디터(g7-comment-editor)는 대상이 아니다.
 *
 * 조각 구성은 전역 스크립트와 같다(`00` 열기 · `10~79` 기능 · `99` 닫기, scripts/build-js.sh 가 이어 붙임).
 */
(function () {
  'use strict';

  var api = window.__G7Ckeditor5Superpack;
  if (!api || typeof api.chunk !== 'function') return;

  api.chunk('write', function (core) {
