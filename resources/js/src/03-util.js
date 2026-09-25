  /* ================================================================ *
   *  공통 유틸
   * ================================================================ */

  var EMBED_WRAPPER_CLASS = 'ck5-media-embed';
  // public_id 만 잡으면 되므로 상대/절대 URL 모두 매칭. 링크 텍스트는 상관 안 함.
  var VIDEO_URL_RE = /\/api\/plugins\/g7-ckeditor5-superpack\/video\/([a-f0-9]{32})\b/i;

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function authToken() {
    try {
      if (window.G7Core && window.G7Core.apiClient && window.G7Core.apiClient.getToken) {
        return window.G7Core.apiClient.getToken() || '';
      }
    } catch (e) {}
    try { return localStorage.getItem('auth_token') || ''; } catch (e) { return ''; }
  }

  function isBareUrlLink(a) {
    var href = a.getAttribute('href') || '';
    if (!/^https?:\/\//i.test(href)) return false;
    var text = (a.textContent || '').trim();
    if (!/^https?:\/\//i.test(text)) return false;
    var norm = function (u) { return u.replace(/\/+$/, '').toLowerCase(); };
    return norm(text) === norm(href);
  }

  /** block(주로 <p>)의 유일한 의미 있는 자식이 맨URL 링크면 그 링크를 반환 */
  function soleLinkOf(block) {
    if ((block.textContent || '').trim() === '') return null;
    var els = [];
    for (var i = 0; i < block.children.length; i++) els.push(block.children[i]);
    if (els.length !== 1) return null;
    var only = els[0];
    if (only.tagName !== 'A') return null;
    if ((block.textContent || '').trim() !== (only.textContent || '').trim()) return null;
    return isBareUrlLink(only) ? only : null;
  }

