window.DASHBOARD_API_CONFIG = window.DASHBOARD_API_CONFIG || {
  // Example:
  // baseUrl: 'https://script.google.com/macros/s/DEPLOYMENT_ID/exec'
  baseUrl: 'https://script.google.com/macros/s/AKfycbx8X-fpWx5YGfDTy1ICHrA1y4FbMpMZYRE1LVM3IDmfp4aLIZQrGYu6QjlUaJYk6XEpPg/exec',
  supabaseApiUrl: '/.netlify/functions/supabase-api',
  apiMode: 'supabase-with-fallback',
  eagerTripsOnStartup: false,
  backgroundTripPreload: false
};
