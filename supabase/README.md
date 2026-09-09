# Supabase Database Migrations

This directory contains database migration scripts for the LetsMeet project.

## Setup

### 1. Install psql (PostgreSQL client)

**Windows (using Chocolatey):**
```bash
choco install postgresql
```

**Windows (manual):**
Download PostgreSQL installer from https://www.postgresql.org/download/windows/ and install just the client tools.

**macOS:**
```bash
brew install postgresql
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt-get install postgresql-client
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env.local`:
```bash
cp .env.example .env.local
```

Edit `.env.local` and add your Supabase credentials:
```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key_here
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@db.your-project.supabase.co:5432/postgres
```

**⚠️ IMPORTANT:** 
- **NEVER commit `.env.local` to version control** (it's in `.gitignore`)
- Store DATABASE_URL securely - it contains your database password
- Regenerate credentials if accidentally exposed

### 3. Find Your Database URL

In your Supabase dashboard:
1. Go to **Project Settings** → **Database**
2. Copy the connection string under **Connection string** (psql section)
3. It looks like: `postgresql://postgres:password@db.xxxxx.supabase.co:5432/postgres`

## Running Migrations

### Preview migrations (dry run)
```bash
npm run db:migrate:dry
```
This shows the SQL that would be executed without making changes.

### Apply migrations
```bash
npm run db:migrate
```
This executes all SQL files in `supabase/migrations/` in alphabetical order.

## Migration Files

Migrations are stored in `supabase/migrations/` with numeric prefixes:
- `001_create_tables.sql` - Initial table creation with RLS policies

### Creating New Migrations

1. Create a new file with the next sequential number:
   ```bash
   supabase/migrations/002_add_new_feature.sql
   ```

2. Write your SQL changes

3. Test with `npm run db:migrate:dry`

4. Apply with `npm run db:migrate`

## Troubleshooting

### "psql: command not found"
PostgreSQL client is not installed. See Setup section above.

### "DATABASE_URL not found in .env.local"
Make sure you created `.env.local` from `.env.example` and filled in the DATABASE_URL.

### "FATAL: password authentication failed"
Double-check your database password in DATABASE_URL. Check your Supabase dashboard for the correct credentials.

### Connection timeout
Verify your Supabase project is running and the host is correct in DATABASE_URL.

## Security Best Practices

1. ✅ Store all credentials in `.env.local` (never in code)
2. ✅ Add `.env.local` to `.gitignore` (already done)
3. ✅ Rotate credentials if ever exposed
4. ✅ Use Row Level Security (RLS) policies in migrations
5. ✅ Review migration SQL before applying
6. ✅ Keep production and development databases separate
7. ✅ Don't share credentials in chat, emails, or tickets

## Alternative: Supabase Web UI

If you prefer not to use the command line, you can also run migrations directly in the Supabase dashboard:

1. Go to your Supabase project
2. Click **SQL Editor** in the sidebar
3. Copy the SQL from `supabase/migrations/001_create_tables.sql`
4. Paste into the editor
5. Click **Run**

## More Information

- [Supabase Documentation](https://supabase.com/docs)
- [PostgreSQL psql Reference](https://www.postgresql.org/docs/current/app-psql.html)
- [Row Level Security Documentation](https://supabase.com/docs/guides/auth/row-level-security)
