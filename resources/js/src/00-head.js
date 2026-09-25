/**
 * g7-ckeditor5-superpack — 프론트 렌더 엔트리 (global 전략, 전 페이지 로드)
 *
 * CKEditor 5(`sirsoft-ckeditor5`)로 작성한 본문에는 링크가 순수 `<a href>` 로만 저장된다.
 * 이 스크립트가 방문자 화면에서 `.ck-content` 를 스캔해:
 *
 *  1. 단독으로 놓인 SNS 링크(YouTube·X·Instagram·TikTok)를 각 플랫폼 임베드로 치환
 *  2. 그 밖의 단독 외부 링크를 서버 프리뷰 API 로 조회해 OG 카드 / 최소 카드로 치환
 *
 * 설정은 `window.G7Config.plugins['g7-ckeditor5-superpack']` (관리자 설정의 frontend_schema
 * 노출분)에서 읽는다. 기능이 꺼져 있으면 해당 스캔을 건너뛴다.
 *
 * 설계 원칙:
 *  - **CKEditor 본체를 건드리지 않는다** — 저장 데이터는 `<a href>` 뿐. 임베드/카드는 화면에서만.
 *  - **멱등** — 대상 노드를 교체하며 처리표시를 남겨 재실행해도 중복 생성이 없다.
 *  - **조용히 깨지지 않는다** — 임베드는 하단에 항상 원문 링크 버튼을 남기고, 카드화 실패 시
 *    원본 링크를 그대로 둔다(긴 URL 은 CSS 로 자동 줄바꿈).
 *  - **SPA 대응** — DOMContentLoaded + rAF + 지연 재시도 + body MutationObserver.
 *
 * (레거시: `sirsoft-ckeditor5` 다운스트림 포크가 previewsInData:false 로 저장하던
 *  `<figure class="media"><oembed url></oembed></figure>` 형태도 함께 처리한다 — 있으면.)
 */
(function () {
  'use strict';

  var IDENTIFIER = 'g7-ckeditor5-superpack';

  var logger = (window.G7Core && window.G7Core.createLogger && window.G7Core.createLogger('Plugin:' + IDENTIFIER)) || {
    log: function () {},
    warn: function () {},
    error: function () {}
  };

