/**
 * g7-ckeditor5-superpack — 프론트 스크립트 (global 전략, 전 페이지 로드)
 *
 * CKEditor 5(`sirsoft-ckeditor5`)로 쓴 본문은 순수 HTML(`<a href>`·`<pre>`·마크다운 글자)로 저장된다.
 * 이 스크립트는 저장 데이터를 바꾸지 않고 화면에서만 다음을 한다.
 *
 *  방문자 화면(`.ck-content`, 편집 영역 제외)
 *   - 마크다운 문법을 서식으로 변환(제목·목록·인용·표·구분선·코드·링크·굵게·기울임)
 *   - 코드 블록에 복사 버튼
 *   - 이 플러그인 동영상 링크를 `<video>` 플레이어로
 *   - 단독 SNS 링크(YouTube·X·Instagram·TikTok)를 임베드로
 *   - 그 밖의 단독 외부 링크를 서버 프리뷰 API 로 OG 카드 / 최소 카드로
 *  글쓰기 화면(게시글 본문 에디터)
 *   - 동영상 업로드 바·라이브러리, 클립보드 이미지 붙여넣기와 업로드 보호(제출 대기·시간 초과)
 *   - 에디터 스타일(글자 크기·줄 간격 표식), 코드·코드 블록 버튼(`ClassicEditor.create` 감싸기)
 *   - 저장된 코드 표시 스타일(툴바 코드·마크다운 코드 같은 모양)
 *
 * 설정은 `window.G7Config.plugins['g7-ckeditor5-superpack']`(관리자 설정의 frontend_schema
 * 노출분)에서 읽는다. 기능이 꺼져 있으면 해당 처리를 건너뛴다.
 *
 * 구조(1.6.0): 이 파일(00)이 IIFE 를 열고 `99-tail.js` 가 닫는다. `01~09` 코어(설정·번역·
 * 유틸·영역·섹션 등록부·스케줄러), `10~79` 기능 섹션(각 조각 끝에서 `core.section()` 으로 등록),
 * `90` 부팅. 감시기 하나가 방문자 스캔(200ms 트레일링)·편집기 스캔(250ms 고정 창)을 요청한다.
 *
 * 설계 원칙:
 *  - **CKEditor 본체를 건드리지 않는다** — 저장 데이터는 그대로. 임베드·카드·서식은 화면에서만.
 *  - **멱등** — 처리 표시를 남겨 다시 돌아도 중복 생성이 없다.
 *  - **조용히 깨지지 않는다** — 임베드는 원문 링크 버튼을 남기고, 카드화 실패 시 원본 링크를 둔다.
 *    한 기능이 예외를 내면 그 기능만 건너뛰고 경고를 한 번 남긴다(`warnOnce`).
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

