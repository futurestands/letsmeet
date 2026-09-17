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

## Security Hardening

### Vulnerability discovered

A critical privilege-escalation issue existed in the organization membership policy model. The earlier grant allowed a user to insert themselves into any organization by setting `user_id = auth.uid()` and using an arbitrary `organization_id`, while also allowing ownership and admin role choice by the client. This meant the browser could effectively self-promote into an organization and escalate privileges without a valid administrative flow.

### Why it was dangerous

The issue allowed a user to join the wrong tenant, create unauthorized organization memberships, and set business-critical roles like `owner` or `admin` using untrusted client input. That path violates the core security model for multi-tenant SaaS and can lead to cross-tenant data access and unauthorized administrative control.

### How it was fixed

The migration was hardened with a new [supabase/migrations/003_saas_security_hardening.sql](../supabase/migrations/003_saas_security_hardening.sql) file. It restricts organization creation to the authenticated user, ensures organization owners are created atomically via a trigger, and requires owner/admin authorization for any membership or workspace creation. The schema also prevents tenant movement on update operations and locks participant role assignment to secure database rules.

### Membership model

Organization membership creation is now controlled. A normal authenticated user cannot create an arbitrary org membership or self-promote to `owner` or `admin`. Ownership is created as part of the organization creation flow, and only the owner/admin path can invite or manage members.

### Role assignment model

The database now enforces that participants may not self-assign privileged roles such as `host`, `co-host`, or `moderator`. Normal participant inserts are limited to the participant role, while host/admin operations must be performed through trusted server-side or controlled administrative logic.

### Tenant immutability

Meeting and scheduled meeting updates are restricted from changing `organization_id`, `workspace_id`, or `host_id` on a user-controlled path. This prevents cross-tenant row movement and protects the integrity of the tenant boundary after creation.

### Previous application checks

The project includes client-side tests in [src/lib/meeting-utils.test.ts](../src/lib/meeting-utils.test.ts) covering organization membership conditions, workspace authorization, meeting access boundaries, and token issuance rules. Those tests do not execute PostgreSQL RLS, triggers, privileges, or migration SQL and are not database security evidence.

## Outcome

The repository is now better aligned with the deployed production database state and the tenant security model required for the SaaS foundation. The app and migration history now reflect the real production architecture rather than the earlier prototype assumptions.

## Final Database Security Audit

Audit baseline: commit `c5df11b5d591606334414278b117cbaae88ea045` (`fix: harden SaaS tenant and role security`). Phase 2 was not started.

### SQL correctness findings

The audit found that [003_saas_security_hardening.sql](../supabase/migrations/003_saas_security_hardening.sql) is not valid PostgreSQL RLS design. `OLD` is referenced in `WITH CHECK` expressions for organizations, memberships, workspaces, meetings, scheduled meetings, participants, and invites. `OLD` and `NEW` exist for trigger functions only; they are not available in policy expressions. Applying 003 therefore fails when PostgreSQL parses those policies.

The migration also failed to drop the policy named `Authenticated users can create organizations` created by 002. PostgreSQL combines permissive policies with OR semantics, so the intended `created_by = auth.uid()` restriction was not the only insert policy. This undermined the owner-creation sequence even apart from the invalid `OLD` references.

Migration [004_correct_rls_security_model.sql](../supabase/migrations/004_correct_rls_security_model.sql) was added without rewriting 001, 002, or 003. It replaces the invalid comparison logic with immutable-field `BEFORE UPDATE` triggers, removes the leftover organization insert policy, hardens helper function execution, and recreates affected policies without `OLD`/`NEW`.

Because 003 cannot complete, the literal fresh-database sequence 001 -> 002 -> 003 -> 004 is not currently reproducible. 004 is the corrective migration for a database where 003's valid prefix was applied or for a repaired migration run; a future release should establish a clean migration baseline rather than claim that the broken 003 chain is executable.

### Verified and unverified controls

The following classifications are based on static SQL and application review only. No PostgreSQL database attack test was executed.

| Property | Classification | Finding |
| --- | --- | --- |
| A. Cannot self-add to arbitrary organization | NOT VERIFIED | 003's stale permissive organization insert policy remains; 004 corrects it. |
| B. Cannot self-create owner/admin membership | NOT VERIFIED | The 003 policy is intended to deny it, but 003 is invalid and was not executed. |
| C. Normal member cannot create another member | NOT VERIFIED | Correct in 003's replacement policy by inspection; not database-tested. |
| D. Normal member cannot change own role | NOT VERIFIED | Update authorization and role check are present in 004; not database-tested. |
| E. Normal member cannot change another member's role | NOT VERIFIED | Update authorization is present in 004; not database-tested. |
| F. Participant cannot self-assign host/co-host/moderator | NOT VERIFIED | Insert and update role checks are present; not database-tested. |
| G. Participant cannot move participant tenant fields | NOT VERIFIED | 004 trigger design enforces this; not database-tested. |
| H. Host cannot move a meeting organization | NOT VERIFIED | 004 trigger design enforces this; not database-tested. |
| I. Host cannot move a meeting workspace | NOT VERIFIED | 004 trigger design enforces this; not database-tested. |
| J. Host cannot change meeting host_id | NOT VERIFIED | 004 trigger design enforces this; not database-tested. |
| K. Scheduled meeting cannot cross tenants | NOT VERIFIED | 004 trigger design enforces this; not database-tested. |
| L. Chat cannot attach to another tenant meeting | NOT VERIFIED | 003's tenant equality checks are present; 003 was not executable/tested. |
| M. Invite cannot attach to another tenant meeting | NOT VERIFIED | 003/004 tenant equality checks are present; not database-tested. |
| N. Organization B cannot read organization A data | NOT VERIFIED | Static policies are tenant-scoped and helpers are made definer-backed in 004; not database-tested. |

No property is classified VERIFIED because the required database-level tests were not run. No property is classified FAILED after the 004 correction by static review, but the migration chain itself is FAILED for reproducibility until the 003 issue is addressed in the migration strategy.

### SECURITY DEFINER and recursion findings

`ensure_organization_owner_membership()` runs as a definer with `search_path = public` and is only invoked by the organization insert trigger. 004 revokes direct execution from `PUBLIC`. `ensure_user_profile_context()` also uses `search_path = public`, checks `p_user_id = auth.uid()`, and remains executable only by `authenticated` after 004; it cannot be called with another user's UUID through the guarded path.

The authorization helpers read `organization_members`, which would recurse if they ran as invoker functions from membership policies. 004 changes the helpers to `SECURITY DEFINER`, fixes the search path, revokes `PUBLIC` execution, and grants only `authenticated` execution. Their definer owner and schema ownership must still be verified in the target Supabase database before deployment.

### Application and LiveKit review

No hard-coded tenant IDs, frontend service-role key, localStorage business-data fallback, or old `is_active` authorization fallback was found. The LiveKit endpoint authenticates the bearer token with Supabase, resolves the meeting by the requested code, derives identity from the authenticated user, and does not accept browser `identity`, `name`, or `role` as authority. Arbitrary room names are rejected. Participant access now requires a matching organization/workspace row with an active attendance state; host access is derived from the meeting's stored `host_id`. The endpoint currently grants the same publish/subscribe permissions to every authorized participant; it does not grant a browser-requested host role, but role-specific LiveKit permissions are not implemented.

The frontend meeting creation helpers currently pass nullable tenant IDs. The database should reject those inserts under the hardened policies; application callers need to obtain the authenticated user's organization/workspace context before creating meetings. This is an application workflow gap, not evidence that client-side authorization can replace RLS.

### Tests and readiness decision

Actually executed during this audit: `npm run lint`, `npm run test` (8 tests passed), `npm run build`, and diagnostics for the reviewed application files; all passed. No PostgreSQL tests were executed. Database cases are designed, not executed, in [DATABASE_SECURITY_TEST_PLAN.md](DATABASE_SECURITY_TEST_PLAN.md). Docker was unavailable and `psql` was not installed; production was not contacted.

Phase 1 is **not ready for Phase 2**. The SQL correction is prepared in 004, but the migration chain is not reproducible and the critical properties remain NOT VERIFIED until an isolated PostgreSQL/Supabase test run succeeds. Do not begin Phase 2.
