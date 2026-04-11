/**
 * Utils — Shared utility functions.
 * Exposed as Nav.Utils so all modules can import without duplicating.
 */
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
      return str.length > maxLen ? str.slice(0, maxLen - 1) + '\u2026' : str;
    }
  };

})(window.Nav = window.Nav || {});
