// We created LogisticsLoader to read the issue ID from the URL and fetch that
// single issue from Supabase, including its type label via a joined select.
(function (Nav) {
  'use strict';

  function LogisticsLoader() {}

  LogisticsLoader.prototype.getIssueId = function () {
    var params = new URLSearchParams(window.location.search);
    return params.get('id') || '';
  };

  LogisticsLoader.prototype.fetch = function (id) {
    var db = Nav.SupabaseClient;
    if (!db) return Promise.reject(new Error('Supabase not initialised'));

    return db
      .from('issues')
      .select('*, issue_types(name, description)')
      .eq('id', id)
      .maybeSingle()
      .then(function (res) {
        if (res.error) throw res.error;
        if (!res.data) throw new Error('Issue not found: ' + id);
        return res.data;
      });
  };

  Nav.LogisticsLoader = new LogisticsLoader();

})(window.Nav = window.Nav || {});
