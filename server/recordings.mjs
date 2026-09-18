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
    };
  }
  if (!process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET || !process.env.LIVEKIT_HOST) {
    return {
      started: false,
      status: recording?.status ?? 'queued',
      reason: 'LiveKit egress is not fully configured. The recording remains queued.',
    };
  }
  return {
    started: false,
    status: recording?.status ?? 'queued',
    reason: 'Storage and LiveKit are configured. The API server starts egress without marking recordings complete until LiveKit reports success.',
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
      return `recordings/${recording.organization_id}/${recording.meeting_id}/${recording.id}.mp4`;
    },
  };
}
