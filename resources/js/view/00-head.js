/**
 * g7-ckeditor5-superpack — 글 보기 묶음 (1.7.0, 지연 로드: dist/js/view.js)
 *
 * 관리자 설정 "글 보기" 탭의 기능(목차·이미지 확대 보기·접기/펼치기·읽는 시간) 중 하나라도 켜져 있고,
 * 화면에 글 본문이 있을 때만 전역 스크립트(07-chunks)가 이 파일을 불러온다.
 * 대상은 글 상세 화면의 글 본문 하나뿐이다(`core.findMainBody()` — 표식 `data-g7-post-body` 우선, 없으면 추정).
 * 페이지·답글 원글 상자·약관 모달·댓글·편집 영역은 대상이 아니다.
 *
 * 조각 구성은 전역 스크립트와 같다(`00` 열기 · `10~79` 기능 · `99` 닫기, scripts/build-js.sh 가 이어 붙임).
 * 기능 조각은 `(function (core) { … })(core);` 로 감싸고 끝에서 `core.section({ load: 'chunk', … })` 로 등록한다.
 */
(function () {
  'use strict';

  var api = window.__G7Ckeditor5Superpack;
  if (!api || typeof api.chunk !== 'function') return;

  api.chunk('view', function (core) {
