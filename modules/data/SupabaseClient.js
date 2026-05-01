// We set up the Supabase client here as the one place that holds the project
// URL and anon key so no other module needs to know about them.
// We read the values from window.ENV which is loaded from env.js — that file
// is gitignored so credentials never get committed to the repository.
(function (Nav) {
  'use strict';

  var SUPABASE_URL  = window.ENV && window.ENV.SUPABASE_URL;
  var SUPABASE_ANON = window.ENV && window.ENV.SUPABASE_ANON;

  Nav.SupabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

})(window.Nav = window.Nav || {});
