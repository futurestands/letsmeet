/**
 * Transcription ingestion and persistence service.
 * Handles speaker mapping and database storage for meeting transcripts.
 */

export async function ingestTranscriptSegment(supabase, segment) {
  const { meeting_id, transcript_id, speaker_user_id, speaker_name, started_ms, ended_ms, body } = segment;

  if (!meeting_id || !transcript_id || !body) {
    throw new Error('Missing required transcript segment fields.');
  }

  const { data, error } = await supabase
    .from('meeting_transcript_segments')
    .insert({
      transcript_id,
      speaker_user_id,
      speaker_name,
      started_ms,
      ended_ms,
      body
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to persist transcript segment: ${error.message}`);
  }

  return data;
}

export async function initializeTranscript(supabase, meeting, recordingId = null) {
  const { data, error } = await supabase
    .from('meeting_transcripts')
    .insert({
      meeting_id: meeting.id,
      recording_id: recordingId,
      organization_id: meeting.organization_id,
      workspace_id: meeting.workspace_id,
      status: 'processing'
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to initialize transcript: ${error.message}`);
  }

  return data;
}

export async function finalizeTranscript(supabase, transcriptId, ok = true, errorMsg = null) {
  const { error } = await supabase
    .from('meeting_transcripts')
    .update({
      status: ok ? 'completed' : 'failed',
      error: errorMsg,
      updated_at: new Date().toISOString()
    })
    .eq('id', transcriptId);

  if (error) {
    throw new Error(`Failed to finalize transcript: ${error.message}`);
  }
}
