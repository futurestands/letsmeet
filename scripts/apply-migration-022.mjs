import fs from 'fs';
import path from 'path';
import pg from 'pg';

const connectionString = 'postgresql://postgres.uasslvisjnwhdhcgqwyc:QWr%3AB%3AVW6k7VyEf@aws-0-eu-west-2.pooler.supabase.com:6543/postgres';

async function applyMigration() {
  console.log('=== APPLYING MIGRATION 022 TO STAGING DATABASE ===\n');

  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log('Connected to staging PostgreSQL database (eu-west-2)...');

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
