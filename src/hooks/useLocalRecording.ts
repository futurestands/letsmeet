import { useCallback, useRef, useState } from 'react';
import { Track, type Room } from 'livekit-client';

export type LocalRecordingState = {
  isRecording: boolean;
  recordingTimeSeconds: number;
  error: string | null;
};

export function useLocalRecording(room: Room | null, meetingCode: string) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTimeSeconds, setRecordingTimeSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const getSupportedMimeType = () => {
    const types = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
      'video/mp4',
    ];
    for (const type of types) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    return '';
  };

  const startLocalRecording = useCallback(async () => {
    if (!room) {
      setError('Meeting room is not connected.');
      return false;
    }

    if (typeof MediaRecorder === 'undefined') {
      setError('Local device recording is not supported in this browser.');
      return false;
    }

    try {
      setError(null);
      chunksRef.current = [];

      // 1. Create AudioContext to mix local microphone + remote audio tracks
      const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      audioContextRef.current = audioCtx;
      const audioDest = audioCtx.createMediaStreamDestination();

      // Mix local microphone audio
      const localAudioTrack = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track?.mediaStreamTrack;
      if (localAudioTrack) {
        const localStream = new MediaStream([localAudioTrack]);
        const localSource = audioCtx.createMediaStreamSource(localStream);
        localSource.connect(audioDest);
      }

      // Mix remote audio tracks
      room.remoteParticipants.forEach((participant) => {
        participant.trackPublications.forEach((pub) => {
          if (pub.kind === Track.Kind.Audio && pub.track?.mediaStreamTrack) {
            try {
              const remoteStream = new MediaStream([pub.track.mediaStreamTrack]);
              const remoteSource = audioCtx.createMediaStreamSource(remoteStream);
              remoteSource.connect(audioDest);
            } catch {
              /* ignore individual track mix error */
            }
          }
        });
      });

      // 2. Select video track (screen share preferred, or local camera track)
      let videoTrack: MediaStreamTrack | undefined;
      const screenPub = room.localParticipant.getTrackPublication(Track.Source.ScreenShare) ||
        Array.from(room.remoteParticipants.values()).flatMap((p) => Array.from(p.trackPublications.values())).find((pub) => pub.source === Track.Source.ScreenShare && pub.track?.mediaStreamTrack);

      if (screenPub?.track?.mediaStreamTrack) {
        videoTrack = screenPub.track.mediaStreamTrack;
      } else {
        const cameraPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
        if (cameraPub?.track?.mediaStreamTrack) {
          videoTrack = cameraPub.track.mediaStreamTrack;
        }
      }

      // Combine video track + mixed audio stream track
      const combinedTracks: MediaStreamTrack[] = [];
      if (videoTrack) combinedTracks.push(videoTrack);
      audioDest.stream.getAudioTracks().forEach((track) => combinedTracks.push(track));

      if (combinedTracks.length === 0) {
        setError('No active camera, microphone, or audio streams available to record.');
        return false;
      }

      const combinedStream = new MediaStream(combinedTracks);
      const mimeType = getSupportedMimeType();

      const options = mimeType ? { mimeType } : undefined;
      const recorder = new MediaRecorder(combinedStream, options);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'video/webm' });
        if (blob.size > 0) {
          const downloadUrl = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.style.display = 'none';
          a.href = downloadUrl;
          const extension = recorder.mimeType.includes('mp4') ? 'mp4' : 'webm';
          a.download = `recording_${meetingCode}_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '_')}.${extension}`;
          document.body.appendChild(a);
          a.click();
          setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(downloadUrl);
          }, 100);
        }

        // Clean up audio context
        if (audioContextRef.current) {
          audioContextRef.current.close().catch(() => undefined);
          audioContextRef.current = null;
        }
      };

      recorder.start(1000);
      setIsRecording(true);
      setRecordingTimeSeconds(0);

      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = window.setInterval(() => {
        setRecordingTimeSeconds((prev) => prev + 1);
      }, 1000);

      return true;
    } catch (err) {
      console.error('Failed to start local device recording:', err);
      setError(err instanceof Error ? err.message : 'Failed to start local recording.');
      return false;
    }
  }, [room, meetingCode]);

  const stopLocalRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  return {
    isRecording,
    recordingTimeSeconds,
    error,
    startLocalRecording,
    stopLocalRecording,
  };
}
