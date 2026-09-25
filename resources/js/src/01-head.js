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
  var API = '/api/plugins/' + IDENTIFIER + '/link-preview';

  var EMBED_WRAPPER_CLASS = 'ck5-media-embed';
  var EMBED_STYLE_ID = 'ck5-media-embed-style';
  var LINKCARD_STYLE_ID = 'ck5-linkcard-style';
  var MAX_INFLIGHT = 3;

  var logger = (window.G7Core && window.G7Core.createLogger && window.G7Core.createLogger('Plugin:' + IDENTIFIER)) || {
    log: function () {},
    warn: function () {},
    error: function () {}
  };

  /* ================================================================ *
   *  설정
   * ================================================================ */

  function asBool(value, fallback) {
    if (value === undefined || value === null) return fallback;
    if (typeof value === 'string') return value !== 'false' && value !== '0' && value !== '';
    return Boolean(value);
  }

  function asInt(value, fallback, min, max) {
    var n = parseInt(value, 10);
    if (!isFinite(n)) n = fallback;
    return Math.max(min, Math.min(max, n));
  }

  function readSettings() {
    var s = (window.G7Config && window.G7Config.plugins && window.G7Config.plugins[IDENTIFIER]) || {};
    var ratio = String(s.sns_shorts_ratio || '9/16');
    if (!/^\d{1,2}\/\d{1,2}$/.test(ratio)) ratio = '9/16';
    return {
      snsEnabled: asBool(s.sns_enabled, true),
      snsYoutube: asBool(s.sns_youtube, true),
      snsTwitter: asBool(s.sns_twitter, true),
      snsInstagram: asBool(s.sns_instagram, true),
      snsTiktok: asBool(s.sns_tiktok, true),
      shortsRatio: ratio,
      linkcardEnabled: asBool(s.linkcard_enabled, true),
      linkcardMinimal: asBool(s.linkcard_minimal_enabled, true),
      imageSize: asInt(s.linkcard_image_size, 168, 80, 400),
      videoEnabled: asBool(s.video_enabled, true),
      videoMaxMb: asInt(s.video_max_mb, 200, 1, 2048),
      videoChunkMb: asInt(s.video_chunk_mb, 20, 1, 28),
      videoAllowMov: asBool(s.video_allow_mov, true),
      videoAllowWebm: asBool(s.video_allow_webm, true),
      videoAllowM4v: asBool(s.video_allow_m4v, false),
      mdEnabled: asBool(s.md_enabled, true),
      mdHeading: asBool(s.md_heading, true),
      mdBold: asBool(s.md_bold, true),
      mdItalic: asBool(s.md_italic, false),
      mdList: asBool(s.md_list, true),
      mdLink: asBool(s.md_link, true),
      mdCode: asBool(s.md_code, true),
      mdQuote: asBool(s.md_quote, true),
      mdTable: asBool(s.md_table, true),
      mdHr: asBool(s.md_hr, true),
      editorStyleEnabled: asBool(s.editor_style_enabled, false),
      editorFontSize: asInt(s.editor_font_size, 16, 12, 28),
      editorLineHeight: asLineHeight(s.editor_line_height, '1.6'),
      editorApplyToComments: asBool(s.editor_apply_to_comments, false),
      imagePasteEnabled: asBool(s.imagepaste_enabled, true)
    };
  }

  /** 줄간격은 Select 로 고정된 프리셋 값만 허용(임의 값 유입 방지, 레이아웃 파손 방어). */
  function asLineHeight(value, fallback) {
    var allowed = ['1.2', '1.4', '1.6', '1.8', '2.0'];
    var v = String(value == null ? '' : value);
    return allowed.indexOf(v) !== -1 ? v : fallback;
  }

  /** 설정에 따른 허용 동영상 확장자 목록 (소문자, .mp4 항상 포함) */
  function allowedVideoExts(cfg) {
    var e = ['mp4'];
    if (cfg.videoAllowMov) e.push('mov');
    if (cfg.videoAllowWebm) e.push('webm');
    if (cfg.videoAllowM4v) e.push('m4v');
    return e;
  }

  /** 플랫폼별 렌더 허용 여부 (플랫폼 마스터 토글 && 개별 토글) */
  function platformEnabled(cfg, platform) {
    if (!cfg.snsEnabled) return false;
    switch (platform) {
      case 'youtube': return cfg.snsYoutube;
      case 'twitter': return cfg.snsTwitter;
      case 'instagram': return cfg.snsInstagram;
      case 'tiktok': return cfg.snsTiktok;
      default: return false;
    }
  }

  /* ================================================================ *
   *  공통 유틸
   * ================================================================ */

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function t(key, fallback) {
    var translate = window.G7Core && window.G7Core.t;
    if (typeof translate !== 'function') return fallback;
    var full = IDENTIFIER + '.' + key;
    var r = translate(full);
    return (typeof r === 'string' && r !== full) ? r : fallback;
  }

