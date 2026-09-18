import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.resolve(root, process.argv[2] ?? '.env.staging.local');
const requiredMigrations = [
  '001_create_tables.sql',
  '002_saas_foundation.sql',
  '003_saas_security_hardening.sql',
  '004_persistent_meeting_system.sql',
  '005_realtime_conferencing.sql',
  '006_supabase_pgcrypto_compatibility.sql',
  '007_scheduling_invitations.sql',
];
const publicVariables = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_LIVEKIT_URL',
  'VITE_LIVEKIT_TOKEN_ENDPOINT',
];
const serverVariables = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'LIVEKIT_HOST',
  'LIVEKIT_API_KEY',
  'LIVEKIT_API_SECRET',
  'ALLOWED_ORIGINS',
];
const administrationVariables = [
  'DATABASE_URL',
  'STAGING_PROJECT_REF',
  'STAGING_CONFIRMATION',
  'PRODUCTION_SUPABASE_URL',
];
const testVariables = [
  'STAGING_TEST_HOST_EMAIL',
  'STAGING_TEST_HOST_PASSWORD',
  'STAGING_TEST_PARTICIPANT_EMAIL',
  'STAGING_TEST_PARTICIPANT_PASSWORD',
];

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
}

function parseEnv(contents) {
  return Object.fromEntries(
    contents
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const separator = line.indexOf('=');
        return separator < 0
          ? [line, '']
          : [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
      }),
  );
}

const migrations = fs.readdirSync(path.join(root, 'supabase', 'migrations'))
  .filter((file) => file.endsWith('.sql'))
  .sort();
if (JSON.stringify(migrations) !== JSON.stringify(requiredMigrations)) {
  fail(`expected migration chain ${requiredMigrations.join(' -> ')}`);
} else {
  console.log(`PASS migration chain: ${requiredMigrations.join(' -> ')}`);
}

for (const variable of serverVariables) {
  if (variable.startsWith('VITE_')) fail(`${variable} is incorrectly classified as server-only`);
}

const trackedSecretFiles = execFileSync(
  'git',
  ['ls-files', '.env', '.env.local', '.env.staging', '.env.staging.local', '.env.production', '.env.production.local'],
  { cwd: root, encoding: 'utf8' },
).trim();
if (trackedSecretFiles) fail('a runtime environment file is tracked by Git');
else console.log('PASS runtime environment files are not tracked');

if (!fs.existsSync(envPath)) {
  fail(`staging environment file is unavailable: ${path.basename(envPath)}`);
  console.log('Create it locally from .env.example; do not commit it.');
  process.exit(process.exitCode || 1);
}

const env = parseEnv(fs.readFileSync(envPath, 'utf8'));
for (const variable of [...publicVariables, ...serverVariables, ...administrationVariables, ...testVariables]) {
  const value = env[variable];
  if (!value || /your_|replace_|example\.(com|invalid)/i.test(value)) {
    fail(`${variable} is missing or still uses a placeholder`);
  } else {
    console.log(`PASS ${variable} is configured`);
  }
}

const forbiddenPublic = Object.keys(env).filter(
  (key) => key.startsWith('VITE_') && /(SECRET|SERVICE_ROLE|DATABASE_URL|PASSWORD)/i.test(key),
);
if (forbiddenPublic.length) fail(`server secrets use public Vite names: ${forbiddenPublic.join(', ')}`);
else console.log('PASS no server secret uses a VITE_ name');

if (env.VITE_SUPABASE_URL !== env.SUPABASE_URL) {
  fail('frontend and backend Supabase URLs do not identify the same staging project');
}
if (env.SUPABASE_URL === env.PRODUCTION_SUPABASE_URL) {
  fail('staging and production Supabase URLs must differ');
}
const stagingProjectRef = env.SUPABASE_URL ? new URL(env.SUPABASE_URL).hostname.split('.')[0] : '';
if (env.STAGING_PROJECT_REF !== stagingProjectRef || env.STAGING_CONFIRMATION !== `staging:${stagingProjectRef}`) {
  fail('staging project confirmation does not match SUPABASE_URL');
}
if (!env.VITE_SUPABASE_URL?.startsWith('https://')) fail('staging Supabase URL must use HTTPS');
if (!env.VITE_LIVEKIT_URL?.startsWith('wss://')) fail('browser LiveKit URL must use WSS');
if (!env.LIVEKIT_HOST?.startsWith('https://')) fail('server LiveKit host must use HTTPS');
if (!env.VITE_LIVEKIT_TOKEN_ENDPOINT?.startsWith('https://')) fail('public token endpoint must use HTTPS');
if (!env.ALLOWED_ORIGINS?.split(',').every((origin) => origin.trim().startsWith('https://'))) {
  fail('every staging allowed origin must use HTTPS');
}

if (!process.exitCode) console.log('Staging configuration preflight passed.');
