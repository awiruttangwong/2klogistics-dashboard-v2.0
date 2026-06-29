export default async function handler(request) {
  const siteUrl = String(process.env.URL || new URL(request.url).origin).replace(/\/+$/, '');
  const response = await fetch(`${siteUrl}/.netlify/functions/supabase-sync-background`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Sync-Token': requiredEnv('NETLIFY_SYNC_TRIGGER_SECRET'),
    },
    body: JSON.stringify({ source: 'netlify-schedule' }),
  });

  if (response.status !== 202) {
    const body = await response.text();
    throw new Error(`Background sync invocation failed with HTTP ${response.status}: ${body.slice(0, 500)}`);
  }

  console.log('[netlify-scheduled-sync] background sync accepted');
}

export const config = {
  schedule: '30 1 * * *',
};

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
