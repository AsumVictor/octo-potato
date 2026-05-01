// We keep IssueTypes as a local fallback so the report form still works if the
// Supabase fetch fails at boot. IssueService.fetchTypes() merges these labels and
// severities with the UUIDs it gets from the DB — the DB name column is the key
// that ties the two together.
(function (Nav) {
  'use strict';

  Nav.IssueTypes = [
    { id: 'safety',        label: 'Safety Hazard',         severity: 'high'   },
    { id: 'fire',          label: 'Fire / Emergency',      severity: 'high'   },
    { id: 'damage',        label: 'Physical Damage',       severity: 'medium' },
    { id: 'flooding',      label: 'Flooding / Water Leak', severity: 'high'   },
    { id: 'electrical',    label: 'Electrical Issue',      severity: 'high'   },
    { id: 'accessibility', label: 'Accessibility Barrier', severity: 'medium' },
    { id: 'cleanliness',   label: 'Cleanliness',           severity: 'low'    },
    { id: 'signage',       label: 'Signage / Wayfinding',  severity: 'low'    },
    { id: 'equipment',     label: 'Equipment / Furniture', severity: 'medium' },
    { id: 'lighting',      label: 'Lighting',              severity: 'medium' },
    { id: 'security',      label: 'Security Concern',      severity: 'high'   },
    { id: 'noise',         label: 'Noise Disturbance',     severity: 'low'    },
    { id: 'other',         label: 'Other',                 severity: 'low'    }
  ];

})(window.Nav = window.Nav || {});
