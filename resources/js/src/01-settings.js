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

  /** 설정 `codeformat_enabled`(기본 켜짐)를 에디터 생성 시점에 읽는다. */
  function codeFormatEnabled() {
    var s = (window.G7Config && window.G7Config.plugins && window.G7Config.plugins[IDENTIFIER]) || {};
    return asBool(s.codeformat_enabled, true);
  }

