export function recordingStorageConfigured() {
  return Boolean(
    process.env.RECORDING_STORAGE_BUCKET
    && process.env.RECORDING_STORAGE_ACCESS_KEY
    && process.env.RECORDING_STORAGE_SECRET
    && process.env.RECORDING_STORAGE_REGION,
  );
}

export function transcriptionProviderConfigured() {
  return Boolean(process.env.TRANSCRIPTION_PROVIDER);
}

export function aiProviderConfigured() {
  return Boolean(process.env.AI_PROVIDER && process.env.AI_API_KEY);
}

export function describeRecordingDispatch(recording) {
  if (!recordingStorageConfigured()) {
    return {
      started: false,
      status: recording?.status ?? 'queued',
      reason: 'Object storage is not configured for LiveKit egress. The recording remains queued.',
      providerRequired: true,
    };
  }
  if (!process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET || !process.env.LIVEKIT_HOST) {
    return {
      started: false,
      status: recording?.status ?? 'queued',
      reason: 'LiveKit egress is not fully configured. The recording remains queued.',
      providerRequired: true,
    };
  }
  return {
    started: true,
    status: recording?.status ?? 'queued',
    reason: 'Storage and LiveKit are configured. The API server starts egress without marking recordings complete until LiveKit reports success.',
    providerRequired: false,
  };
}

export function recordingStatusPayload() {
  return {
    storageConfigured: recordingStorageConfigured(),
    livekitConfigured: Boolean(process.env.LIVEKIT_HOST && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET),
    transcriptionConfigured: transcriptionProviderConfigured(),
    note: 'Queued recordings are not complete. Playback is available only after LiveKit egress finishes and storage returns an object key.',
  };
}

export function createRecordingStorageAdapter() {
  if (!recordingStorageConfigured()) return null;
  return {
    provider: process.env.RECORDING_STORAGE_PROVIDER || 's3',
    bucket: process.env.RECORDING_STORAGE_BUCKET,
    region: process.env.RECORDING_STORAGE_REGION,
    objectKeyFor(recording) {
      // Use ISO date folder for better organization
      const date = new Date().toISOString().split('T')[0];
      return `recordings/${date}/${recording.organization_id}/${recording.meeting_id}/${recording.id}.mp4`;
    },
  };
}

export async function verifyStorageObjectExists(adapter, storageKey) {
  if (!adapter || !storageKey) return false;
  if (!recordingStorageConfigured()) return false;
  try {
    const { S3Client, HeadObjectCommand } = await import('@aws-sdk/client-s3');
    const s3 = new S3Client({
      region: adapter.region,
      credentials: {
        accessKeyId: process.env.RECORDING_STORAGE_ACCESS_KEY,
        secretAccessKey: process.env.RECORDING_STORAGE_SECRET,
      },
    });
    await s3.send(new HeadObjectCommand({
      Bucket: adapter.bucket,
      Key: storageKey,
    }));
    return true;
  } catch (err) {
    console.error('Storage object existence check failed:', err?.message || err);
    return false;
  }
}

export const RECORDING_STATUS = {
  QUEUED: 'queued',
  STARTING: 'starting',
  ACTIVE: 'active',
  STOPPING: 'stopping',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};
