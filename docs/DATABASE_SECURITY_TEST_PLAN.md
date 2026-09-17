# Database Security Test Plan

Status: DESIGNED - NOT EXECUTED.

These tests must run only against an isolated local PostgreSQL/Supabase database created from the migration chain. Do not run them against production. The local Docker database was unavailable during this audit, and `psql` was not installed, so no database attack test is claimed as passed.

## Preconditions

Create two authenticated users, two organizations, and two workspaces:

- `:user_a`, `:user_b`
- `:org_a`, `:org_b`
- `:workspace_a`, `:workspace_b`
- `:meeting_a`, `:meeting_b`, `:scheduled_a`, `:participant_a`, `:invite_a`

Seed memberships so `user_a` is an owner/member in Org A and `user_b` is an owner/member in Org B. Seed Meeting A, Scheduled Meeting A, Participant A, Chat Message A, and Invite A in Org A. Apply migrations in a clean database before running the cases.

For each case, use an authenticated database session and set the JWT subject before the statement:

```sql
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', ':user_a', true);
```

Use a savepoint before each expected failure and roll back to it afterward. A statement that succeeds where `DENIED` is expected is a test failure.

## Organization and membership attacks

```sql
-- A: self-join to an arbitrary organization: DENIED
SAVEPOINT attack_a;
INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES (':org_b', ':user_a', 'member', 'active');
ROLLBACK TO SAVEPOINT attack_a;

-- B: self-promotion to owner/admin: DENIED
SAVEPOINT attack_b;
INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES (':org_a', ':user_a', 'owner', 'active');
ROLLBACK TO SAVEPOINT attack_b;

SAVEPOINT attack_b_admin;
INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES (':org_a', ':user_a', 'admin', 'active');
ROLLBACK TO SAVEPOINT attack_b_admin;

-- C: ordinary member creating another member: DENIED unless the test actor is owner/admin
SAVEPOINT attack_c;
INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES (':org_a', ':user_b', 'member', 'active');
ROLLBACK TO SAVEPOINT attack_c;

-- D/E: ordinary member role changes: DENIED
SAVEPOINT attack_d;
UPDATE public.organization_members
SET role = 'admin'
WHERE organization_id = ':org_a' AND user_id = ':user_a';
ROLLBACK TO SAVEPOINT attack_d;

SAVEPOINT attack_e;
UPDATE public.organization_members
SET role = 'guest'
WHERE organization_id = ':org_a' AND user_id = ':user_b';
ROLLBACK TO SAVEPOINT attack_e;
```

## Participant and tenant movement attacks

```sql
-- F: participant cannot self-assign a privileged role: DENIED for each value
SAVEPOINT attack_f_host;
UPDATE public.meeting_participants SET role = 'host' WHERE id = ':participant_a';
ROLLBACK TO SAVEPOINT attack_f_host;

SAVEPOINT attack_f_cohost;
UPDATE public.meeting_participants SET role = 'co-host' WHERE id = ':participant_a';
ROLLBACK TO SAVEPOINT attack_f_cohost;

SAVEPOINT attack_f_moderator;
UPDATE public.meeting_participants SET role = 'moderator' WHERE id = ':participant_a';
ROLLBACK TO SAVEPOINT attack_f_moderator;

-- G: participant tenant/meeting movement: DENIED
SAVEPOINT attack_g;
UPDATE public.meeting_participants
SET organization_id = ':org_b', workspace_id = ':workspace_b', meeting_id = ':meeting_b'
WHERE id = ':participant_a';
ROLLBACK TO SAVEPOINT attack_g;
```

## Meeting and scheduled-meeting movement attacks

```sql
-- H/I/J: host cannot move or reassign Meeting A: DENIED
SAVEPOINT attack_hij;
UPDATE public.meetings
SET organization_id = ':org_b', workspace_id = ':workspace_b', host_id = ':user_b'
WHERE id = ':meeting_a';
ROLLBACK TO SAVEPOINT attack_hij;

-- K: scheduled meeting tenant movement: DENIED
SAVEPOINT attack_k;
UPDATE public.scheduled_meetings
SET organization_id = ':org_b', workspace_id = ':workspace_b', host_id = ':user_b'
WHERE id = ':scheduled_a';
ROLLBACK TO SAVEPOINT attack_k;
```

The trigger assertions should also be run by an owner/admin service test role to confirm the immutable fields cannot be changed even when RLS is bypassed by that role.

## Cross-tenant content attacks

```sql
-- L: chat cannot attach to another tenant's meeting: DENIED
SAVEPOINT attack_l;
INSERT INTO public.chat_messages (meeting_id, organization_id, workspace_id, user_id, user_name, message)
VALUES (':meeting_b', ':org_b', ':workspace_b', ':user_a', 'User A', 'cross-tenant');
ROLLBACK TO SAVEPOINT attack_l;

-- M: invite cannot attach to another tenant's meeting: DENIED
SAVEPOINT attack_m;
INSERT INTO public.meeting_invites (meeting_id, organization_id, workspace_id, email)
VALUES (':meeting_b', ':org_b', ':workspace_b', 'user-b@example.test');
ROLLBACK TO SAVEPOINT attack_m;

-- N: Org B user cannot read Org A protected rows: zero rows
SELECT COUNT(*) = 0 AS no_org_a_visibility
FROM public.meetings
WHERE organization_id = ':org_a';

-- Cross-tenant DELETE: denied because no tenant-authorized delete policy exists
SAVEPOINT attack_delete_meeting;
DELETE FROM public.meetings WHERE id = ':meeting_a';
ROLLBACK TO SAVEPOINT attack_delete_meeting;

SAVEPOINT attack_delete_participant;
DELETE FROM public.meeting_participants WHERE id = ':participant_a';
ROLLBACK TO SAVEPOINT attack_delete_participant;

SAVEPOINT attack_delete_invite;
DELETE FROM public.meeting_invites WHERE id = ':invite_a';
ROLLBACK TO SAVEPOINT attack_delete_invite;
```

Run the same cross-tenant delete cases as `user_b` against Org A rows. Every delete must be denied. The scheduled-meeting delete policy is intentionally limited to the meeting host and must also be tested with a non-host.

## Owner creation sequence

Run an organization insert as an authenticated user with `created_by = auth.uid()`, then verify exactly one active owner membership was created by the trigger. Repeat with `created_by` set to another UUID and with `created_by IS NULL`; both inserts must be denied. Direct client insertion of an owner membership must be denied.

## Function and privilege checks

```sql
SELECT p.proname, p.prosecdef, p.proconfig, r.rolname AS owner
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_roles r ON r.oid = p.proowner
WHERE n.nspname = 'public'
  AND p.proname IN (
    'is_org_member', 'is_org_owner_or_admin', 'is_workspace_member',
    'is_workspace_in_org', 'is_meeting_in_org',
    'ensure_organization_owner_membership', 'ensure_user_profile_context'
  );

SELECT routine_name, grantee, privilege_type
FROM information_schema.routine_privileges
WHERE specific_schema = 'public'
  AND routine_name IN (
    'is_org_member', 'is_org_owner_or_admin', 'is_workspace_member',
    'is_workspace_in_org', 'is_meeting_in_org',
    'ensure_organization_owner_membership', 'ensure_user_profile_context'
  )
ORDER BY routine_name, grantee;
```

Expected: authorization helpers are `SECURITY DEFINER`, have `search_path = public`, and are executable by `authenticated` but not `PUBLIC`. The owner-membership trigger function is not executable by `PUBLIC`; the profile-context function is executable by `authenticated` and rejects a UUID different from `auth.uid()`.

## LiveKit access cases

These cases exercise the token endpoint with bearer tokens obtained for isolated test users. They are designed, not executed here.

```text
User B requests room code for Meeting A: HTTP 403.
User A requests an unknown or malformed room code: HTTP 400 or 404.
User A has a participant row for Meeting A with status left or removed: HTTP 403.
User A has a participant row whose organization_id or workspace_id differs from Meeting A: HTTP 403.
User A requests role=host, identity=User B, or an arbitrary tenant parameter: the request cannot change the issued identity, room, or authorization; host access is derived only from stored meeting.host_id.
```

These endpoint cases are DESIGNED - NOT EXECUTED in this audit.
