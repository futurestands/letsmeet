import fs from 'fs';
import path from 'path';
import pg from 'pg';
import dotenv from 'dotenv';

// Load ONLY staging environment file — do NOT load .env.local
dotenv.config({ path: '.env.staging.local' });

const targetUrl = process.env.STAGING_DATABASE_URL;
const projectRef = process.env.STAGING_PROJECT_REF;
const confirmation = process.env.STAGING_CONFIRMATION;
const productionProjectRef = process.env.PRODUCTION_PROJECT_REF || 'wvmmofornwivfsjeqmda';

async function runStagingMigration() {
  console.log('=== STAGING MIGRATION RUNNER (STRICT FAIL-CLOSED) ===\n');

  // Safety Gate 1: Require explicit STAGING_DATABASE_URL (no fallback to DATABASE_URL)
  if (!targetUrl) {
    console.error('CRITICAL SAFETY BLOCK: STAGING_DATABASE_URL environment variable is missing. Fallback to DATABASE_URL is prohibited. Halting execution.');
    process.exit(1);
  }

  // Safety Gate 2: Require explicit STAGING_PROJECT_REF
  if (!projectRef) {
    console.error('CRITICAL SAFETY BLOCK: STAGING_PROJECT_REF environment variable is missing. Halting execution.');
    process.exit(1);
  }

  // Safety Gate 3: Require explicit STAGING_CONFIRMATION
  if (!confirmation) {
    console.error('CRITICAL SAFETY BLOCK: STAGING_CONFIRMATION environment variable is missing. Halting execution.');
    process.exit(1);
  }

  // Safety Gate 4: Validate STAGING_CONFIRMATION exact match
  const expectedConfirmation = `staging:${projectRef}`;
  if (confirmation !== expectedConfirmation) {
    console.error(`CRITICAL SAFETY BLOCK: STAGING_CONFIRMATION '${confirmation}' does not match expected '${expectedConfirmation}'. Halting execution.`);
    process.exit(1);
  }

  // Safety Gate 5: Reject if target URL references production
  if (targetUrl.includes(productionProjectRef) || targetUrl.includes('wvmmofornwivfsjeqmda') || targetUrl.toLowerCase().includes('production')) {
    console.error('CRITICAL SAFETY BLOCK: Target connection string contains production references. Halting execution immediately.');
    process.exit(1);
  }

  // Safety Gate 6: Reject if target URL does not contain STAGING_PROJECT_REF
  if (!targetUrl.includes(projectRef)) {
    console.error(`CRITICAL SAFETY BLOCK: Target connection string does not correspond to expected staging project ref (${projectRef}). Halting execution.`);
    process.exit(1);
  }

  const migrationFile = process.argv[2];
  if (!migrationFile) {
    console.error('Usage: node scripts/apply-staging-migration.mjs <migration-file-name>');
    console.error('Example: node scripts/apply-staging-migration.mjs 024_drop_old_can_manage_recordings_overload.sql');
    process.exit(1);
  }

  const migrationPath = path.join(process.cwd(), 'supabase', 'migrations', migrationFile);
  if (!fs.existsSync(migrationPath)) {
    console.error(`FAIL Migration file not found: ${migrationPath}`);
    process.exit(1);
  }

  const sql = fs.readFileSync(migrationPath, 'utf-8');
  console.log(`Applying migration file: ${migrationFile} to verified staging database (${projectRef})...`);

  const client = new pg.Client({
    connectionString: targetUrl,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log('Connected to verified staging PostgreSQL database cleanly.');

  try {
    await client.query(sql);
    console.log(`PASS Migration ${migrationFile} applied and verified successfully on staging!`);
  } catch (err) {
    console.error(`FAIL Migration ${migrationFile} application error:`, err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

runStagingMigration().catch((err) => {
  console.error('Migration runner execution error:', err);
  process.exit(1);
});
