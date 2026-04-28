(function (Nav) {
  'use strict';

  var SUPABASE_URL  = window.ENV && window.ENV.SUPABASE_URL;
  var SUPABASE_ANON = window.ENV && window.ENV.SUPABASE_ANON;

  Nav.SupabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

})(window.Nav = window.Nav || {});
