import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);

loadDotEnvFile();

if (args.length === 0 || args[0] === 'help') {
  printHelp();
  process.exit(args.length === 0 ? 1 : 0);
}

const command = args[0];
const preparedArgs = prepareArgs(args);
assertRequiredEnv(command, preparedArgs);

const child = spawn('supabase', preparedArgs, {
  stdio: 'inherit',
  env: buildChildEnv(),
  shell: process.platform === 'win32',
});

child.on('exit', code => {
  process.exitCode = code ?? 1;
});

child.on('error', error => {
  console.error(`[supabase-cli] failed to start Supabase CLI: ${error.message}`);
  console.error('[supabase-cli] Install the CLI first, then run this npm script again.');
  process.exitCode = 1;
});

function prepareArgs(inputArgs) {
  if (inputArgs[0] !== 'link') return inputArgs;
  if (inputArgs.includes('--project-ref')) return inputArgs;

  const projectRef = getProjectRef();
  if (!projectRef) return inputArgs;

  return ['link', '--project-ref', projectRef, ...inputArgs.slice(1)];
}

function buildChildEnv() {
  const env = { ...process.env };
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') || 'Path';
  const localBin = resolve(process.cwd(), 'node_modules', '.bin');
  env[pathKey] = `${localBin}${process.platform === 'win32' ? ';' : ':'}${env[pathKey] || ''}`;
  return env;
}

function assertRequiredEnv(commandName, prepared) {
  const isRemoteDbCommand = commandName === 'db' && prepared[1] === 'push';
  const isLinkCommand = commandName === 'link';
  const required = [];

  if (isLinkCommand || isRemoteDbCommand) {
    required.push('SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_PASSWORD');
  }

  if (isLinkCommand && !getProjectRef()) {
    required.push('SUPABASE_PROJECT_REF or SUPABASE_URL');
  }

  const missing = required.filter(name => {
    if (name === 'SUPABASE_PROJECT_REF or SUPABASE_URL') return !getProjectRef();
    return isBlankOrPlaceholder(process.env[name]);
  });

  if (missing.length) {
    console.error(`[supabase-cli] missing required environment variables: ${missing.join(', ')}`);
    console.error('[supabase-cli] Copy .env.example to .env and fill local server-side values.');
    process.exit(1);
  }
}

function getProjectRef() {
  if (!isBlankOrPlaceholder(process.env.SUPABASE_PROJECT_REF)) return process.env.SUPABASE_PROJECT_REF.trim();
  const url = process.env.SUPABASE_URL || '';
  const match = url.match(/^https:\/\/([a-z0-9-]+)\.supabase\.co\/?$/i);
  return match ? match[1] : '';
}

function isBlankOrPlaceholder(value) {
  const text = String(value || '').trim();
  return !text || /^<[^>]+>$/.test(text);
}

function loadDotEnvFile(filePath = '.env') {
  const resolved = resolve(process.cwd(), filePath);
  if (!existsSync(resolved)) return;

  const text = readFileSync(resolved, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    const commentAt = value.indexOf(' #');
    if (commentAt >= 0) value = value.slice(0, commentAt).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) process.env[key] = value;
  }
}

function printHelp() {
  console.log(`
Usage:
  npm run supabase:link
  npm run supabase:db:push:dry-run
  npm run supabase:db:push

Required .env values for remote CLI commands:
  SUPABASE_PROJECT_REF or SUPABASE_URL
  SUPABASE_ACCESS_TOKEN
  SUPABASE_DB_PASSWORD

The wrapper loads .env, adds --project-ref for supabase link, and passes secrets
through environment variables instead of committing them to the repo.
`.trim());
}
