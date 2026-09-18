import { createClient } from '@supabase/supabase-js';

const required = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'STAGING_PROJECT_REF',
  'STAGING_CONFIRMATION',
  'PRODUCTION_SUPABASE_URL',
  'STAGING_TEST_HOST_EMAIL',
  'STAGING_TEST_HOST_PASSWORD',
  'STAGING_TEST_PARTICIPANT_EMAIL',
  'STAGING_TEST_PARTICIPANT_PASSWORD',
];

for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is required`);
}

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  STAGING_PROJECT_REF,
  STAGING_CONFIRMATION,
  PRODUCTION_SUPABASE_URL,
  STAGING_TEST_HOST_EMAIL,
  STAGING_TEST_HOST_PASSWORD,
  STAGING_TEST_PARTICIPANT_EMAIL,
  STAGING_TEST_PARTICIPANT_PASSWORD,
} = process.env;

const projectRef = new URL(SUPABASE_URL).hostname.split('.')[0];
if (projectRef !== STAGING_PROJECT_REF || STAGING_CONFIRMATION !== `staging:${projectRef}`) {
  throw new Error('Staging confirmation does not match the configured Supabase project');
}
if (PRODUCTION_SUPABASE_URL && new URL(PRODUCTION_SUPABASE_URL).origin === new URL(SUPABASE_URL).origin) {
  throw new Error('Refusing to seed the configured production Supabase project');
}
if (STAGING_TEST_HOST_EMAIL === STAGING_TEST_PARTICIPANT_EMAIL) {
  throw new Error('Staging host and participant must use different email addresses');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function resolveTestUser(email, password, fullName) {
  const { data: listed, error: listError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) throw listError;
  const existing = listed.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
  if (existing) return existing;

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, purpose: 'phase-3-staging-acceptance' },
  });
  if (error || !data.user) throw error ?? new Error('Test user could not be created');
  return data.user;
}

const host = await resolveTestUser(STAGING_TEST_HOST_EMAIL, STAGING_TEST_HOST_PASSWORD, 'Staging Test Host');
const participant = await resolveTestUser(
  STAGING_TEST_PARTICIPANT_EMAIL,
  STAGING_TEST_PARTICIPANT_PASSWORD,
  'Staging Test Participant',
);

const { error: profileError } = await supabase.from('users').upsert([
  { id: host.id, email: STAGING_TEST_HOST_EMAIL, full_name: 'Staging Test Host' },
  { id: participant.id, email: STAGING_TEST_PARTICIPANT_EMAIL, full_name: 'Staging Test Participant' },
], { onConflict: 'id' });
if (profileError) throw profileError;

let { data: organization, error: organizationError } = await supabase
  .from('organizations')
  .select('id')
  .eq('slug', 'letsmeet-staging-acceptance')
  .maybeSingle();
if (organizationError) throw organizationError;
if (!organization) {
  const result = await supabase
    .from('organizations')
    .insert({ name: 'LeTsMeet Staging Acceptance', slug: 'letsmeet-staging-acceptance', created_by: host.id })
    .select('id')
    .single();
  if (result.error) throw result.error;
  organization = result.data;
}

const { error: memberError } = await supabase.from('organization_members').upsert([
  {
    organization_id: organization.id,
    user_id: host.id,
    role: 'owner',
    status: 'active',
    invited_by: host.id,
  },
  {
    organization_id: organization.id,
    user_id: participant.id,
    role: 'member',
    status: 'active',
    invited_by: host.id,
  },
], { onConflict: 'organization_id,user_id', ignoreDuplicates: true });
if (memberError) throw memberError;

let { data: workspace, error: workspaceError } = await supabase
  .from('workspaces')
  .select('id')
  .eq('organization_id', organization.id)
  .eq('slug', 'acceptance')
  .maybeSingle();
if (workspaceError) throw workspaceError;
if (!workspace) {
  const result = await supabase
    .from('workspaces')
    .insert({
      organization_id: organization.id,
      name: 'Acceptance',
      slug: 'acceptance',
      created_by: host.id,
    })
    .select('id')
    .single();
  if (result.error) throw result.error;
  workspace = result.data;
}

console.log('Staging acceptance identities are ready.');
console.log(`Organization ID: ${organization.id}`);
console.log(`Workspace ID: ${workspace.id}`);
