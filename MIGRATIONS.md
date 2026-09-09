# Database Migration Quick Start

## 🚀 Quick Setup (5 minutes)

### Step 1: Create your .env.local file
```bash
cp .env.example .env.local
```

### Step 2: Add your credentials to .env.local
Edit `.env.local` and fill in:
- `VITE_SUPABASE_URL` - from your Supabase dashboard
- `VITE_SUPABASE_ANON_KEY` - from your Supabase dashboard  
- `DATABASE_URL` - PostgreSQL connection string (found in Supabase > Settings > Database)

### Step 3: Install PostgreSQL client (if needed)
```bash
# Windows (Chocolatey)
choco install postgresql

# macOS
brew install postgresql

# Linux
sudo apt-get install postgresql-client
```

### Step 4: Run migrations
```bash
# Preview what will be executed
npm run db:migrate:dry

# Apply migrations
npm run db:migrate
```

## 📁 File Structure

```
letsmeet/
├── .env.example              # Template (safe to commit)
├── .env.local                # Your credentials (DO NOT COMMIT)
├── supabase/
│   ├── migrations/
│   │   └── 001_create_tables.sql
│   └── README.md
└── scripts/
    └── migrate.js            # Migration runner
```

## ⚠️ Security Reminders

- **Never** commit `.env.local` to git (it's in `.gitignore`)
- **Never** share your DATABASE_URL with anyone
- **Rotate** credentials if you accidentally expose them
- Use `.env.example` to show other developers what variables are needed

## 🆘 Need Help?

See `supabase/README.md` for detailed troubleshooting and alternatives.
