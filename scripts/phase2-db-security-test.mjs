import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const psql = 'C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe';
const pgIsReady = 'C:\\Program Files\\PostgreSQL\\18\\bin\\pg_isready.exe';
const initdb = 'C:\\Program Files\\PostgreSQL\\18\\bin\\initdb.exe';
const pgCtl = 'C:\\Program Files\\PostgreSQL\\18\\bin\\pg_ctl.exe';
const port = '55433';
const password = 'phase2test';
const containerName = 'letsmeet-phase2-pg';

function runPsql(databaseUrl, filePath) {
  execFileSync(psql, ['--set', 'ON_ERROR_STOP=1', '-f', filePath, databaseUrl], {
    stdio: 'inherit',
    env: { ...process.env, PGPASSWORD: password },
  });
}

function query(databaseUrl, sql) {
  return execFileSync(psql, ['-tA', '-c', sql, databaseUrl], {
    encoding: 'utf8',
    env: { ...process.env, PGPASSWORD: password },
  }).trim();
}

function sleep(ms) {
  execFileSync('powershell', ['-NoProfile', '-Command', `Start-Sleep -Milliseconds ${ms}`], { stdio: 'ignore' });
}

function waitForReady(host = '127.0.0.1') {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = spawnSync(pgIsReady, ['-h', host, '-p', port, '-U', 'postgres'], { encoding: 'utf8' });
    if (result.status === 0) return;
    sleep(500);
  }
  throw new Error('PostgreSQL did not become ready on port ' + port);
}

function startDocker() {
  spawnSync('docker', ['rm', '-f', containerName], { stdio: 'ignore' });
  const started = spawnSync('docker', [
    'run', '-d', '--name', containerName,
    '-e', `POSTGRES_PASSWORD=${password}`,
    '-p', `${port}:5432`,
    'postgres:18',
  ], { encoding: 'utf8' });
  if (started.status !== 0) {
    throw new Error(started.stderr || started.stdout || 'Unable to start docker postgres');
  }
  waitForReady();
  return {
    url: `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`,
    cleanup() {
      spawnSync('docker', ['rm', '-f', containerName], { stdio: 'ignore' });
    },
  };
}

function startLocalCluster() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'letsmeet-phase2-pg-'));
  const pwFile = path.join(os.tmpdir(), `letsmeet-phase2-pw-${Date.now()}.txt`);
  fs.writeFileSync(pwFile, password);
  execFileSync(initdb, [
    '-D', dataDir,
    '-U', 'postgres',
    '-A', 'password',
    `--pwfile=${pwFile}`,
    '-E', 'UTF8',
    '--locale=C',
  ], { stdio: 'inherit' });
  execFileSync(pgCtl, ['-D', dataDir, '-o', `-p ${port}`, '-l', path.join(dataDir, 'pg.log'), 'start'], { stdio: 'inherit' });
  waitForReady();
  return {
    url: `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`,
    cleanup() {
      spawnSync(pgCtl, ['-D', dataDir, '-m', 'fast', 'stop'], { stdio: 'ignore' });
    },
  };
}

let cluster;
try {
  cluster = startDocker();
  console.log('Started isolated PostgreSQL 18 container on port', port);
} catch (error) {
  console.warn('Docker PostgreSQL unavailable, falling back to local initdb:', error.message);
  cluster = startLocalCluster();
  console.log('Started isolated local PostgreSQL cluster on port', port);
}

try {
  const migrations = [
    path.join(__dirname, 'phase2-db-bootstrap.sql'),
    path.join(root, 'supabase', 'migrations', '001_create_tables.sql'),
    path.join(root, 'supabase', 'migrations', '002_saas_foundation.sql'),
    path.join(root, 'supabase', 'migrations', '003_saas_security_hardening.sql'),
    path.join(root, 'supabase', 'migrations', '004_persistent_meeting_system.sql'),
    path.join(__dirname, 'phase2-db-security-test.sql'),
  ];

  for (const filePath of migrations) {
    console.log('\nRunning', path.basename(filePath));
    runPsql(cluster.url, filePath);
  }

  const summary = query(cluster.url, 'SELECT count(*)::text || \',\' || count(*) FILTER (WHERE passed)::text || \',\' || count(*) FILTER (WHERE NOT passed)::text FROM public.phase2_assertions;');
  const [total, passed, failed] = summary.split(',');
  console.log(`\nPhase 2 database security assertions: ${passed}/${total} passed, ${failed} failed`);
  if (Number(failed) > 0) {
    const failures = query(cluster.url, "SELECT string_agg(name || ': ' || coalesce(detail, ''), E'\\n') FROM public.phase2_assertions WHERE NOT passed;");
    console.error(failures);
    process.exitCode = 1;
  }
} finally {
  cluster.cleanup();
}
