import fs from 'fs';
import path from 'path';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.staging.local' });
dotenv.config({ path: '.env.local' });

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('DATABASE_URL environment variable is required.');
  process.exit(1);
}

async function applyMigration() {
  console.log('=== APPLYING MIGRATION 022 TO STAGING DATABASE ===\n');

  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log('Connected to staging PostgreSQL database...');

  const migrationPath = path.join(process.cwd(), 'supabase', 'migrations', '022_recording_state_machine_enforcement.sql');
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  try {
    await client.query(sql);
    console.log('PASS Migration 022 applied successfully!');
  } catch (err) {
    console.error('FAIL Migration 022 application error:', err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

applyMigration().catch(console.error);
