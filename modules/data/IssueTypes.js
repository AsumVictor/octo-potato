/**
 * IssueTypes — Single source of truth for all reportable issue categories.
 *
 * Schema per entry:
 *   id       {string}  Machine key stored in reports (never rename without migration)
 *   label    {string}  Human-readable label shown in the dropdown
 *   icon     {string}  Emoji glyph used alongside the label
 *   severity {string}  "low" | "medium" | "high" — default triage priority
 *
 * Add new types here; the report form reads this list automatically.
 */
(function (Nav) {
  'use strict';

  Nav.IssueTypes = [
    { id: 'safety',        label: 'Safety Hazard',          icon: '⚠️',  severity: 'high'   },
    { id: 'fire',          label: 'Fire / Emergency',       icon: '🔥',  severity: 'high'   },
    { id: 'damage',        label: 'Physical Damage',        icon: '🪟',  severity: 'medium' },
    { id: 'flooding',      label: 'Flooding / Water Leak',  icon: '💧',  severity: 'high'   },
    { id: 'electrical',    label: 'Electrical Issue',       icon: '⚡',  severity: 'high'   },
    { id: 'accessibility', label: 'Accessibility Barrier',  icon: '♿',  severity: 'medium' },
    { id: 'cleanliness',   label: 'Cleanliness',            icon: '🧹',  severity: 'low'    },
    { id: 'signage',       label: 'Signage / Wayfinding',   icon: '🪧',  severity: 'low'    },
    { id: 'equipment',     label: 'Equipment / Furniture',  icon: '🪑',  severity: 'medium' },
    { id: 'lighting',      label: 'Lighting',               icon: '💡',  severity: 'medium' },
    { id: 'security',      label: 'Security Concern',       icon: '🔒',  severity: 'high'   },
    { id: 'noise',         label: 'Noise Disturbance',      icon: '🔊',  severity: 'low'    },
    { id: 'other',         label: 'Other',                  icon: '📋',  severity: 'low'    }
  ];

})(window.Nav = window.Nav || {});
