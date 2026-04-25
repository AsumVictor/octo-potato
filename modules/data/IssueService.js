(function (Nav) {
  'use strict';

  var BUCKET = 'issue-images';

  function IssueService() {}

  /**
   * Submit a report to Supabase.
   * @param {Object} report   - built by ReportTool.submitReport
   * @param {Function} onSuccess
   * @param {Function} onError  - called with an Error
   */
  IssueService.prototype.submit = function (report, onSuccess, onError) {
    var db = Nav.SupabaseClient;
    if (!db) {
      onError && onError(new Error('Supabase client not initialised — check env.js'));
      return;
    }

    _uploadImages(db, report.pictures)
      .then(function (imageUrls) {
        return _resolveIds(db, report.issue.id).then(function (ids) {
          return db
            .from('issues')
            .insert({
              reporter_email: report.reporter.email,
              issue_type_id:  ids.issueTypeId,
              status_id:      ids.statusId,
              metadata: {
                reporter_name: report.reporter.name,
                description:   report.issue.description,
                severity:      report.issue.severity,
                location:      report.location
              },
              images: imageUrls
            });
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

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function _resolveIds(db, issueTypeKey) {
    return Promise.all([
      db.from('issue_types').select('id').eq('name', issueTypeKey).single(),
      db.from('issue_statuses').select('id').eq('name', 'open').single()
    ]).then(function (results) {
      if (results[0].error) throw new Error('Unknown issue type: "' + issueTypeKey + '"');
      if (results[1].error) throw new Error('Status "open" not found in issue_statuses');
      return { issueTypeId: results[0].data.id, statusId: results[1].data.id };
    });
  }

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
