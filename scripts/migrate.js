#!/usr/bin/env node

/**
 * Database Migration Script
 * 
 * Usage:
 *   node scripts/migrate.js        # Run all pending migrations
 *   node scripts/migrate.js --dry  # Dry run (show what would be executed)
 * 
 * Environment variables (from .env.local):
 *   DATABASE_URL - PostgreSQL connection string
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.dirname(__dirname);

// Load environment variables
const envLocalPath = path.join(projectRoot, '.env.local');
if (!fs.existsSync(envLocalPath)) {
  console.error('❌ Error: .env.local file not found!');
  console.error(`Expected at: ${envLocalPath}`);
  console.error('\nPlease create .env.local by copying .env.example and filling in your credentials.');
  process.exit(1);
}

// Read .env.local
const envContent = fs.readFileSync(envLocalPath, 'utf-8');
const envVars = {};
envContent.split('\n').forEach(line => {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith('#')) {
    const [key, ...valueParts] = trimmed.split('=');
    envVars[key.trim()] = valueParts.join('=').trim();
  }
});

const databaseUrl = envVars.DATABASE_URL;
if (!databaseUrl) {
  console.error('❌ Error: DATABASE_URL not found in .env.local');
  process.exit(1);
}

const isDryRun = process.argv.includes('--dry');
const migrationsDir = path.join(projectRoot, 'supabase', 'migrations');

async function runMigrations() {
  console.log('🔄 Starting database migrations...\n');

  if (!fs.existsSync(migrationsDir)) {
    console.error(`❌ Migrations directory not found: ${migrationsDir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('✅ No migrations to run');
    return;
  }

  console.log(`Found ${files.length} migration(s):\n`);
  files.forEach((file, idx) => {
    console.log(`  ${idx + 1}. ${file}`);
  });
  console.log();

  if (isDryRun) {
    console.log('📋 Dry run mode - showing SQL that would be executed:\n');
    files.forEach(file => {
      const filePath = path.join(migrationsDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      console.log(`\n--- ${file} ---`);
      console.log(content);
      console.log('--- end ---\n');
    });
    return;
  }

  // Execute migrations
  for (const file of files) {
    const filePath = path.join(migrationsDir, file);
    console.log(`▶️  Running: ${file}`);

    try {
      const sql = fs.readFileSync(filePath, 'utf-8');
      
      // Use psql to execute the SQL file
      // We need to pass the SQL via stdin to keep password secure
      const cmd = `psql "${databaseUrl}" -f "${filePath}"`;
      
      try {
        execSync(cmd, { 
          stdio: 'pipe',
          env: { ...process.env }
        });
        console.log(`   ✅ Completed\n`);
      } catch (error) {
        // psql might return warnings but still succeed, so check actual error
        const stderr = error.stderr?.toString() || '';
        const stdout = error.stdout?.toString() || '';
        
        if (stderr.includes('ERROR') || error.status !== 0) {
          throw error;
        }
        console.log(`   ⚠️  Completed with warnings\n`);
      }
    } catch (error) {
      console.error(`   ❌ Failed: ${error.message}\n`);
      process.exit(1);
    }
  }

  console.log('✅ All migrations completed successfully!\n');
}

runMigrations().catch(error => {
  console.error('❌ Migration failed:', error.message);
  process.exit(1);
});
