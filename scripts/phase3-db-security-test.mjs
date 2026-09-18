import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const postgresBin = 'C:\\Program Files\\PostgreSQL\\18\\bin';
const psql = path.join(postgresBin, 'psql.exe');
const pgIsReady = path.join(postgresBin, 'pg_isready.exe');
const initdb = path.join(postgresBin, 'initdb.exe');
const pgCtl = path.join(postgresBin, 'pg_ctl.exe');
const port = '55434';
const password = 'phase3test';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'letsmeet-phase3-pg-'));
const pwFile = path.join(os.tmpdir(), `letsmeet-phase3-pw-${process.pid}.txt`);
const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;

function run(filePath) {
  console.log(`Running ${path.basename(filePath)}`);
  execFileSync(psql, ['--set', 'ON_ERROR_STOP=1', '-f', filePath, databaseUrl], {
    stdio: 'inherit',
    env: { ...process.env, PGPASSWORD: password },
  });
}

function query(sql) {
  return execFileSync(psql, ['-tA', '-c', sql, databaseUrl], {
    encoding: 'utf8',
    env: { ...process.env, PGPASSWORD: password },
  }).trim();
}

fs.writeFileSync(pwFile, password);
execFileSync(initdb, [
  '-D', dataDir,
  '-U', 'postgres',
  '-A', 'password',
  `--pwfile=${pwFile}`,
  '-E', 'UTF8',
  '--locale=C',
], { stdio: 'inherit' });

let started = false;
try {
  execFileSync(pgCtl, ['-D', dataDir, '-o', `-p ${port}`, '-l', path.join(dataDir, 'pg.log'), 'start'], { stdio: 'inherit' });
  started = true;

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const ready = spawnSync(pgIsReady, ['-h', '127.0.0.1', '-p', port, '-U', 'postgres']);
    if (ready.status === 0) break;
    execFileSync('powershell', ['-NoProfile', '-Command', 'Start-Sleep -Milliseconds 250'], { stdio: 'ignore' });
  }

  [
    path.join(__dirname, 'phase2-db-bootstrap.sql'),
    path.join(root, 'supabase', 'migrations', '001_create_tables.sql'),
    path.join(root, 'supabase', 'migrations', '002_saas_foundation.sql'),
    path.join(root, 'supabase', 'migrations', '003_saas_security_hardening.sql'),
    path.join(root, 'supabase', 'migrations', '004_persistent_meeting_system.sql'),
    path.join(root, 'supabase', 'migrations', '005_realtime_conferencing.sql'),
    path.join(__dirname, 'phase3-db-security-test.sql'),
  ].forEach(run);

  const summary = query("SELECT count(*)::text || ',' || count(*) FILTER (WHERE passed)::text || ',' || count(*) FILTER (WHERE NOT passed)::text FROM public.phase3_assertions;");
  const [total, passed, failed] = summary.split(',');
  console.log(`Phase 3 database security assertions: ${passed}/${total} passed, ${failed} failed`);
  if (Number(failed) > 0) process.exitCode = 1;
} finally {
  if (started) spawnSync(pgCtl, ['-D', dataDir, '-m', 'fast', 'stop'], { stdio: 'ignore' });
  fs.rmSync(pwFile, { force: true });
}
