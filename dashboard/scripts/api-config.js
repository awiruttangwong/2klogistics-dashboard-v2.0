window.DASHBOARD_API_CONFIG = window.DASHBOARD_API_CONFIG || {
  // Example:
  // baseUrl: 'https://script.google.com/macros/s/DEPLOYMENT_ID/exec'
  baseUrl: 'https://script.google.com/macros/s/AKfycbwCcI17V6ocXp_ELEJa7kjUHXV5zIchdPxIaHNT-ibNQZPksWtjNDdlxqRIcatFSQjVwQ/exec',
  supabaseApiUrl: '/.netlify/functions/supabase-api',
  apiMode: 'supabase-with-fallback',
  eagerTripsOnStartup: false,
  backgroundTripPreload: false
};
