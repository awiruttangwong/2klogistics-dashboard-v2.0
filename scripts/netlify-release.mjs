import { appendFile } from 'node:fs/promises';

const API_BASE = 'https://api.netlify.com/api/v1';
const API_ATTEMPTS = 3;
const API_TIMEOUT_MS = 20_000;
const EXPECTED_SCHEDULE = Object.freeze({
  name: 'schedule-supabase-sync',
  cron: '30 1 * * *',
});

const [command, deployId] = process.argv.slice(2);

main().catch(error => {
  console.error(`[netlify-release] failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});

async function main() {
  if (!['verify', 'promote', 'rollback'].includes(command) || !deployId) {
    throw new Error('Usage: node scripts/netlify-release.mjs <verify|promote|rollback> <deploy-id>');
  }

  const token = requiredEnv('NETLIFY_AUTH_TOKEN');
  const siteId = requiredEnv('NETLIFY_SITE_ID');
  const site = await api(`/sites/${encodeURIComponent(siteId)}`, { token });
  const candidate = await api(`/deploys/${encodeURIComponent(deployId)}`, { token });

  validateCandidate(candidate, siteId, { requireSchedule: command !== 'rollback' });

  const previousDeployId = site?.published_deploy?.id || '';
  if (command === 'verify') {
    console.log(JSON.stringify({
      ok: true,
      command,
      siteId,
      previousDeployId,
      candidateDeployId: candidate.id,
      functionSchedules: candidate.function_schedules || [],
    }, null, 2));
    return;
  }

  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `previous_deploy_id=${previousDeployId}\n`, 'utf8');
  }

  const restored = await api(
    `/sites/${encodeURIComponent(siteId)}/deploys/${encodeURIComponent(deployId)}/restore`,
    { token, method: 'POST' }
  );

  if (restored?.id !== deployId || !restored?.published_at) {
    throw new Error('Netlify restore response does not confirm the requested deploy was published');
  }

  const result = {
    ok: true,
    command,
    siteId,
    previousDeployId,
    publishedDeployId: restored.id,
    publishedAt: restored.published_at,
    functionSchedules: restored.function_schedules || [],
  };
  console.log(JSON.stringify(result, null, 2));

  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `published_deploy_id=${restored.id}\n`, 'utf8');
  }
}

function validateCandidate(candidate, siteId, { requireSchedule }) {
  if (!candidate || candidate.id !== deployId) throw new Error('Netlify candidate deploy was not found');
  if (candidate.site_id !== siteId) throw new Error('Candidate deploy belongs to a different Netlify site');
  if (candidate.state !== 'ready') throw new Error(`Candidate deploy state is ${candidate.state || 'missing'}`);

  if (requireSchedule) {
    const schedules = candidate.function_schedules || [];
    const hasExpectedSchedule = schedules.some(schedule => (
      schedule.name === EXPECTED_SCHEDULE.name && schedule.cron === EXPECTED_SCHEDULE.cron
    ));
    if (!hasExpectedSchedule) {
      throw new Error(`Candidate deploy is missing ${EXPECTED_SCHEDULE.name} at ${EXPECTED_SCHEDULE.cron}`);
    }
  }
}

async function api(path, { token, method = 'GET' }) {
  let lastError = null;
  for (let attempt = 1; attempt <= API_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(`${API_BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });
      const text = await response.text();
      if (!response.ok) {
        const error = new Error(`Netlify API ${method} ${path} returned HTTP ${response.status}: ${trim(text)}`);
        if (response.status < 500 || attempt === API_ATTEMPTS) throw error;
        lastError = error;
      } else {
        try {
          return text ? JSON.parse(text) : null;
        } catch {
          throw new Error(`Netlify API ${method} ${path} returned invalid JSON`);
        }
      }
    } catch (error) {
      lastError = error;
      if (attempt === API_ATTEMPTS || !isRetryable(error)) throw error;
    }
    console.warn(`[netlify-release] ${lastError.message}; retrying ${attempt}/${API_ATTEMPTS}`);
    await sleep(1000 * attempt);
  }
  throw lastError || new Error(`Netlify API ${method} ${path} failed`);
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function trim(value) {
  const text = String(value || '');
  return text.length > 500 ? `${text.slice(0, 500)}...` : text;
}

function isRetryable(error) {
  return error?.name === 'TimeoutError'
    || error?.name === 'AbortError'
    || /HTTP 5\d\d/.test(String(error?.message || ''));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
