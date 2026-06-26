window.DASHBOARD_API_CONFIG = window.DASHBOARD_API_CONFIG || {
  // Example:
  // baseUrl: 'https://script.google.com/macros/s/DEPLOYMENT_ID/exec'
  baseUrl: 'https://script.google.com/macros/s/AKfycbwCcI17V6ocXp_ELEJa7kjUHXV5zIchdPxIaHNT-ibNQZPksWtjNDdlxqRIcatFSQjVwQ/exec',
  supabaseApiUrl: '/.netlify/functions/supabase-api',
  // Incident failover 2026-06-26: Supabase is returning 503 while storage cleanup/recovery is in progress.
  // Switch back to 'supabase-with-fallback' after production:health passes again.
  apiMode: 'apps-script',
  eagerTripsOnStartup: false,
  backgroundTripPreload: false
};
