function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function stagingIdentities() {
  return {
    hostEmail: required('STAGING_TEST_HOST_EMAIL'),
    hostPassword: required('STAGING_TEST_HOST_PASSWORD'),
    participantEmail: required('STAGING_TEST_PARTICIPANT_EMAIL'),
    participantPassword: required('STAGING_TEST_PARTICIPANT_PASSWORD'),
    tokenEndpoint: required('VITE_LIVEKIT_TOKEN_ENDPOINT'),
    previewUrl:
      process.env.STAGING_PREVIEW_URL?.trim()
      || 'https://letsmeet-git-phase-1-saas-foundation-futurestands-projects.vercel.app',
  };
}

export function assertNoSecretLeak(text: string) {
  if (/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/.test(text)) {
    throw new Error('Possible JWT leaked into diagnostics output');
  }
}
