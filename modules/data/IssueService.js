// We created IssueService to handle the full Supabase submission flow so
// ReportTool stays focused on UI and doesn't need to know about the DB schema.
// We also added fetchTypes() so the UI dropdown is driven by what is actually in
// the DB rather than a hardcoded list — that way adding a new type in Supabase is
// enough and no JS deploy is needed.
(function (Nav) {
  'use strict';

  var BUCKET = 'issue-images';

  function IssueService() {}

  // We fetch issue types from the DB and enrich them with labels and severities
  // from the local IssueTypes fallback array. If the fetch fails we fall back to
  // the local list so the form still works offline or before DB is seeded.
  IssueService.prototype.fetchTypes = function () {
    var db = Nav.SupabaseClient;
    if (!db) return Promise.resolve(Nav.IssueTypes || []);

    return db.from('issue_types').select('id, name').order('name')
      .then(function (res) {
        if (res.error || !res.data || !res.data.length) {
          console.warn('[IssueService] fetchTypes fell back to local list:', res.error);
          return Nav.IssueTypes || [];
        }

        var localMap = {};
        (Nav.IssueTypes || []).forEach(function (t) { localMap[t.id] = t; });

        return res.data.map(function (row) {
          var local = localMap[row.name] || {};
          return {
            uuid:     row.id,
            name:     row.name,
            label:    local.label || row.name,
            severity: local.severity || 'low'
          };
        });
      });
  };

  IssueService.prototype.submit = function (report, onSuccess, onError) {
    var db = Nav.SupabaseClient;
    if (!db) {
      onError && onError(new Error('Supabase client not initialised — check env.js'));
      return;
    }

    _uploadImages(db, report.pictures)
      .then(function (imageUrls) {
        // status_id is omitted — the DB column default (open_status_id() function)
        // sets it automatically so we never need to query issue_statuses from the client.
        return db.from('issues').insert({
          reporter_email: report.reporter.email,
          issue_type_id:  report.issue.id,
          metadata: {
            reporter_name: report.reporter.name,
            description:   report.issue.description,
            severity:      report.issue.severity,
            location:      report.location
          },
          images: imageUrls
        });
      })
      .then(function (res) {
        if (res && res.error) throw res.error;
        onSuccess && onSuccess();
      })
      .catch(function (err) {
        onError && onError(err);
      });
  };

  // We sanitise the filename before uploading because Supabase Storage rejects
  // paths with spaces and special characters.
  function _uploadImages(db, files) {
    if (!files || !files.length) return Promise.resolve([]);
    var uploads = files.map(function (f) {
      var safeName = f.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      var path     = Date.now() + '_' + safeName;
      return db.storage
        .from(BUCKET)
        .upload(path, f, { upsert: false })
        .then(function (res) {
          if (res.error) throw res.error;
          return db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
        });
    });
    return Promise.all(uploads);
  }

  Nav.IssueService = new IssueService();

})(window.Nav = window.Nav || {});
