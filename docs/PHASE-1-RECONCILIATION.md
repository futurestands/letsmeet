# Phase 1 Reconciliation

## What was discovered

The repository originally contained a lightweight prototype database migration in [supabase/migrations/001_create_tables.sql](../supabase/migrations/001_create_tables.sql). That file created only the demo schema for:

- users
- meetings
- scheduled_meetings
- meeting_participants
- chat_messages
- meeting_invites

It used permissive RLS and demo fields like `is_active`, and it did not implement the multi-tenant SaaS model that the production database had already been configured with.

The production Supabase environment had already executed the higher-level SaaS foundation manually. That environment includes the tenant boundary model used by LeTsMeet:

- Organization
- Organization membership
- Workspace
- Meeting
- Participant

The repository did not contain the corresponding migration history, which made the project non-reproducible and inconsistent with the actual deployed database state.

## Why 001 was not the SaaS migration

The file [supabase/migrations/001_create_tables.sql](../supabase/migrations/001_create_tables.sql) was useful as a starter schema but it was not a real SaaS migration. It had these problems:

- no organizations table
- no organization_members table
- no workspaces table
- no subscription/usage aggregates
- no tenant-aware meeting ownership model
- no organization or workspace foreign keys on meetings
- no meeting lifecycle status constraints
- permissive `SELECT USING (true)` policies
- no realistic tenant authorization model
- no `updated_at` orchestration for auditability

This mismatch caused the app code to drift toward demo assumptions instead of the deployed production schema.

## What 002 introduces

The new migration [supabase/migrations/002_saas_foundation.sql](../supabase/migrations/002_saas_foundation.sql) adds the missing tenant SaaS foundation while preserving the existing `001` base schema and making the repository reproducible from scratch.

It introduces:

- organizations
- organization_members
- workspaces
- subscriptions
- usage_daily
- tenant linkage on meetings and scheduled meetings
- tenant linkage on participants, chat, and invites
- lifecycle statuses for meetings
- user provisioning functions and tenant context helpers
- updated_at triggers
- safer RLS policies

## Database and repository alignment

The repository is now aligned with the intended architecture:

- real tenant boundary: organization → workspace → meeting
- user profiles remain in `public.users`
- meetings are tied to their owning organization and workspace
- meeting access depends on membership and tenant authorization rather than knowledge of a code alone
- LiveKit token issuance now follows the same tenant-aware flow
- the frontend no longer relies on old-schema fallback logic

## RLS changes

The previous migration exposed data to any authenticated or anonymous user. The new migration tightens those rules substantially.

Examples:

- `public.users` is only readable by the user themselves
- `public.organizations` is viewable only by members
- `public.organization_members` is scoped to the organization
- `public.workspaces` is restricted to org members
- `public.meetings` is restricted to members of the owning organization
- `public.scheduled_meetings` is restricted to members of the owning organization
- `public.meeting_participants` is readable only when the user has meeting/tenant access
- `public.chat_messages` is restricted to meeting-aware members
- `public.meeting_invites` is restricted to the owning organization and meeting host authorization

This moves the authorization model from permissive demo rules to tenancy-aware policy enforcement.

## Auth changes

The app is now aligned with the expectation that user provisioning must be tenant-safe and idempotent. The app authenticates with Supabase and treats the application profile as a persisted record in `public.users` rather than a temporary browser-only identity.

The repository now includes the logic to create or detect the default org/workspace context for a first-time user without hard-coded tenant IDs.

## LiveKit authorization

The server endpoint in [server/livekit-token.mjs](../server/livekit-token.mjs) verifies:

- valid bearer token
- authenticated user identity
- meeting existence by code
- tenant membership
- meeting access
- meeting status
- user role/participant chain before issuing a LiveKit grant

It still uses a bounded token lifetime and rejects invalid or unauthorized room codes, which prevents arbitrary room control by a browser client.

## Data access changes

The app-level access layer in [src/lib/data-access.ts](../src/lib/data-access.ts) was cleaned to remove compatibility fallback logic that silently assumed the old table shape. It now targets the intended SaaS schema and exposes explicit tenant context retrieval and data access helpers rather than prototype Schema B fallback behavior.

This removes the old `is_active` fallback pattern and ensures the repository expects the proper SaaS architecture.

## Remaining limitations

This is still a Phase 1 reconciliation and not a full enterprise product. The repository is now coherent with the SaaS foundation, but the remaining gaps are still expected at this stage:

- role-specific meeting controls beyond host/member basics
- full moderation flow for muted/waiting/removed states
- richer organization management UI
- subscription enforcement
- full tenant-scoped audit trail
- advanced collaboration and AI features are still future phases

## Outcome

The repository is now better aligned with the deployed production database state and can be used to recreate the intended tenant-aware schema from scratch without needing to re-run the production SQL.
