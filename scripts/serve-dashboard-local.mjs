import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT_DIR = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DASHBOARD_DIR = resolve(ROOT_DIR, 'Dashboard');
const FUNCTION_PATH = resolve(ROOT_DIR, 'dashboard/functions/api/supabase-api.js');
const DEFAULT_PORT = 8899;

loadDotEnv(resolve(ROOT_DIR, '.env'));

const { onRequestGet } = await import(`${pathToFileURL(FUNCTION_PATH).href}?dev=${Date.now()}`);
const functionEnv = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  APPS_SCRIPT_API_URL: process.env.APPS_SCRIPT_API_URL,
  SUPABASE_MIN_OPERATIONAL_DATE: process.env.SUPABASE_MIN_OPERATIONAL_DATE,
};

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.csv': 'text/csv; charset=utf-8',
};

const requestedPort = Number(process.env.DASHBOARD_DEV_PORT || process.env.PORT || DEFAULT_PORT);
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || `127.0.0.1:${requestedPort}`}`);

    if (url.pathname === '/api/supabase-api') {
      const result = await onRequestGet({
        request: new Request(url, { method: req.method || 'GET' }),
        env: functionEnv,
      });
      res.writeHead(result.status || 200, Object.fromEntries(result.headers.entries()));
      res.end(Buffer.from(await result.arrayBuffer()));
      return;
    }

    const relativePath = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^\/+/, '');
    const filePath = resolve(DASHBOARD_DIR, relativePath);
    if (!filePath.startsWith(DASHBOARD_DIR)) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    const body = await readFile(filePath);
    res.writeHead(200, { 'content-type': mimeTypes[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch (error) {
    const status = error?.code === 'ENOENT' ? 404 : 500;
    res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(status === 404 ? 'Not found' : (error?.message || 'Server error'));
  }
});

server.listen(requestedPort, '127.0.0.1', () => {
  console.log(`Dashboard local server: http://127.0.0.1:${requestedPort}/`);
  console.log('Supabase function route: /api/supabase-api');
});

function loadDotEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || match[1].startsWith('#')) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}
