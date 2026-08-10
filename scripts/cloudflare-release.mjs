const API_BASE = 'https://api.cloudflare.com/client/v4';
const API_ATTEMPTS = 3;
const API_TIMEOUT_MS = 20_000;

const [command, arg] = process.argv.slice(2);

main().catch(error => {
  console.error(`[cloudflare-release] failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});

async function main() {
  if (!['current-production-id', 'rollback'].includes(command)) {
    throw new Error('Usage: node scripts/cloudflare-release.mjs <current-production-id|rollback> [deploymentId]');
  }
  if (command === 'rollback' && !arg) {
    throw new Error('Usage: node scripts/cloudflare-release.mjs rollback <deploymentId>');
  }

  const token = requiredEnv('CLOUDFLARE_API_TOKEN');
  const accountId = requiredEnv('CLOUDFLARE_ACCOUNT_ID');
  const projectName = requiredEnv('CLOUDFLARE_PAGES_PROJECT');

  if (command === 'current-production-id') {
    const result = await api(
      `/accounts/${accountId}/pages/projects/${projectName}/deployments?env=production&per_page=1`,
      { token }
    );
    const deploymentId = result?.result?.[0]?.id || '';
    console.log(JSON.stringify({ ok: true, deploymentId }, null, 2));
    if (process.env.GITHUB_OUTPUT) {
      const { appendFile } = await import('node:fs/promises');
      await appendFile(process.env.GITHUB_OUTPUT, `previous_deploy_id=${deploymentId}\n`, 'utf8');
    }
    return;
  }

  const restored = await api(
    `/accounts/${accountId}/pages/projects/${projectName}/deployments/${arg}/rollback`,
    { token, method: 'POST' }
  );
  if (!restored?.success) {
    throw new Error(`Cloudflare rollback did not report success: ${JSON.stringify(restored?.errors || restored)}`);
  }
  console.log(JSON.stringify({ ok: true, command, rolledBackTo: arg, result: restored.result }, null, 2));
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
        const error = new Error(`Cloudflare API ${method} ${path} returned HTTP ${response.status}: ${trim(text)}`);
        if (response.status < 500 || attempt === API_ATTEMPTS) throw error;
        lastError = error;
      } else {
        try {
          return text ? JSON.parse(text) : null;
        } catch {
          throw new Error(`Cloudflare API ${method} ${path} returned invalid JSON`);
        }
      }
    } catch (error) {
      lastError = error;
      if (attempt === API_ATTEMPTS || !isRetryable(error)) throw error;
    }
    console.warn(`[cloudflare-release] ${lastError.message}; retrying ${attempt}/${API_ATTEMPTS}`);
    await sleep(1000 * attempt);
  }
  throw lastError || new Error(`Cloudflare API ${method} ${path} failed`);
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
