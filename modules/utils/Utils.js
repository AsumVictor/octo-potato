// We added these helpers to avoid duplicating string escaping and truncation
// logic across modules. escapeHtml is used whenever we inject user-supplied
// text into innerHTML to prevent XSS.
(function (Nav) {
  'use strict';

  Nav.Utils = {
    escapeHtml: function (s) {
      return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    },

    truncate: function (str, maxLen) {
      if (!str) return '';
      return str.length > maxLen ? str.slice(0, maxLen - 1) + '…' : str;
    }
  };

})(window.Nav = window.Nav || {});
