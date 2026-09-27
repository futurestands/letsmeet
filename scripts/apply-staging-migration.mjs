import fs from 'fs';
import path from 'path';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.staging.local' });
dotenv.config({ path: '.env.local' });

const targetUrl = process.env.STAGING_DATABASE_URL || process.env.DATABASE_URL;
const confirmation = process.env.STAGING_CONFIRMATION || '';
const expectedProjectRef = process.env.STAGING_PROJECT_REF || 'uasslvisjnwhdhcgqwyc';
const productionProjectRef = process.env.PRODUCTION_PROJECT_REF || 'wvmmofornwivfsjeqmda';

async function runStagingMigration() {
  console.log('=== STAGING MIGRATION RUNNER ===\n');

  if (!targetUrl) {
    console.error('FAIL Missing STAGING_DATABASE_URL or DATABASE_URL environment variable.');
    process.exit(1);
  }

  // Safety Gate 1: Check production project ref protection
  if (targetUrl.includes(productionProjectRef) || targetUrl.includes('wvmmofornwivfsjeqmda')) {
    console.error('CRITICAL SAFETY BLOCK: Target connection appears to reference the PRODUCTION database. Halting execution immediately.');
    process.exit(1);
  }

  // Safety Gate 2: Check staging project ref in target URL
  if (!targetUrl.includes(expectedProjectRef) && !targetUrl.includes('uasslvisjnwhdhcgqwyc')) {
    console.error(`CRITICAL SAFETY BLOCK: Target connection string does not match expected staging project ref (${expectedProjectRef}). Halting execution.`);
    process.exit(1);
  }

  // Safety Gate 3: Require explicit STAGING_CONFIRMATION
  const expectedConfirmation = `staging:${expectedProjectRef}`;
  if (confirmation !== expectedConfirmation && confirmation !== 'staging:uasslvisjnwhdhcgqwyc') {
    console.error(`CRITICAL SAFETY BLOCK: Invalid STAGING_CONFIRMATION '${confirmation}'. Expected '${expectedConfirmation}'. Halting execution.`);
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
  console.log(`Applying migration file: ${migrationFile} to staging database (${expectedProjectRef})...`);

  const client = new pg.Client({
    connectionString: targetUrl,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log('Connected to staging PostgreSQL database cleanly.');

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
