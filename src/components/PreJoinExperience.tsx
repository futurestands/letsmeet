import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, CameraOff, Mic, MicOff, Speaker, Video } from 'lucide-react';
import { usePreviewTracks } from '@livekit/components-react';
import { Track, VideoPresets, type LocalVideoTrack } from 'livekit-client';
import type { MeetingSummary } from '../lib/data-access';
import { mediaErrorMessage, resolveSelectedDeviceId, type PreJoinSettings } from '../lib/conference-utils';
import { useMediaDevices } from '../hooks/useMediaDevices';

type PreJoinExperienceProps = {
  meeting: MeetingSummary;
  displayName: string;
  joining: boolean;
  joinError: string | null;
  onJoin: (settings: PreJoinSettings) => void;
};

function DeviceSelect({
  label,
  value,
  devices,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  devices: MediaDeviceInfo[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</span>
      <select
        value={value}
        disabled={disabled || devices.length === 0}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100"
      >
        {devices.length === 0 && <option value="">No device available</option>}
        {devices.map((device, index) => (
          <option key={device.deviceId || `${device.kind}-${index}`} value={device.deviceId}>
            {device.label || `${label} ${index + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function PreJoinExperience({
  meeting,
  displayName,
  joining,
  joinError,
  onJoin,
}: PreJoinExperienceProps) {
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [audioDeviceId, setAudioDeviceId] = useState('');
  const [videoDeviceId, setVideoDeviceId] = useState('');
  const [audioOutputDeviceId, setAudioOutputDeviceId] = useState('');
  const [mediaError, setMediaError] = useState<string | null>(null);
  const videoElement = useRef<HTMLVideoElement | null>(null);
  const devices = useMediaDevices();
  const refreshDevices = devices.refresh;
  const activeAudioDeviceId = resolveSelectedDeviceId(audioDeviceId, devices.microphones);
  const activeVideoDeviceId = resolveSelectedDeviceId(videoDeviceId, devices.cameras);
  const activeOutputDeviceId = resolveSelectedDeviceId(audioOutputDeviceId, devices.speakers);

  const handlePreviewError = useCallback((error: Error) => {
    setMediaError(mediaErrorMessage(error));
  }, []);

  const previewOptions = useMemo(() => ({
    audio: audioEnabled ? { deviceId: activeAudioDeviceId || undefined } : false,
    video: videoEnabled
      ? {
          deviceId: activeVideoDeviceId || undefined,
          resolution: VideoPresets.h720.resolution,
        }
      : false,
  }), [activeAudioDeviceId, activeVideoDeviceId, audioEnabled, videoEnabled]);

  const tracks = usePreviewTracks(previewOptions, handlePreviewError);
  const videoTrack = tracks?.find((track) => track.kind === Track.Kind.Video) as LocalVideoTrack | undefined;

  useEffect(() => {
    if (tracks?.length) void refreshDevices();
  }, [refreshDevices, tracks?.length]);

  useEffect(() => {
    const element = videoElement.current;
    if (!element || !videoTrack) return undefined;
    videoTrack.attach(element);
    return () => {
      videoTrack.detach(element);
    };
  }, [videoTrack]);

  const ready = devices.supported && (!audioEnabled || devices.microphones.length > 0) && (!videoEnabled || devices.cameras.length > 0);

  return (
    <div className="grid gap-8 lg:grid-cols-[1.35fr_0.85fr]">
      <section className="overflow-hidden rounded-3xl bg-slate-950 shadow-2xl shadow-slate-300">
        <div className="relative aspect-video min-h-72">
          {videoEnabled && videoTrack ? (
            <video ref={videoElement} autoPlay playsInline muted className="h-full w-full scale-x-[-1] object-cover" />
          ) : (
            <div className="flex h-full min-h-72 flex-col items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800 text-white">
              <div className="flex h-24 w-24 items-center justify-center rounded-full bg-blue-600 text-3xl font-bold">
                {displayName.slice(0, 2).toUpperCase()}
              </div>
              <p className="mt-4 text-sm text-slate-400">{videoEnabled ? 'Starting camera…' : 'Camera is off'}</p>
            </div>
          )}
          <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-3">
            <button
              type="button"
              onClick={() => setAudioEnabled((enabled) => !enabled)}
              className={`flex h-12 w-12 items-center justify-center rounded-full text-white shadow-lg focus:outline-none focus:ring-2 focus:ring-blue-400 ${audioEnabled ? 'bg-slate-700/90' : 'bg-red-600'}`}
              aria-label={audioEnabled ? 'Turn off microphone' : 'Turn on microphone'}
              title={audioEnabled ? 'Turn off microphone' : 'Turn on microphone'}
            >
              {audioEnabled ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
            </button>
            <button
              type="button"
              onClick={() => setVideoEnabled((enabled) => !enabled)}
              className={`flex h-12 w-12 items-center justify-center rounded-full text-white shadow-lg focus:outline-none focus:ring-2 focus:ring-blue-400 ${videoEnabled ? 'bg-slate-700/90' : 'bg-red-600'}`}
              aria-label={videoEnabled ? 'Turn off camera' : 'Turn on camera'}
              title={videoEnabled ? 'Turn off camera' : 'Turn on camera'}
            >
              {videoEnabled ? <Camera className="h-5 w-5" /> : <CameraOff className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
            <Video className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-700">Ready to join</p>
            <h1 className="text-xl font-bold text-slate-900">{meeting.title}</h1>
            <p className="text-sm text-slate-500">{meeting.code}</p>
          </div>
        </div>

        <div className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Display name</span>
            <input value={displayName} readOnly className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700" />
          </label>
          <DeviceSelect label="Microphone" value={activeAudioDeviceId} devices={devices.microphones} disabled={!audioEnabled} onChange={setAudioDeviceId} />
          <DeviceSelect label="Camera" value={activeVideoDeviceId} devices={devices.cameras} disabled={!videoEnabled} onChange={setVideoDeviceId} />
          {devices.outputSelectionSupported && (
            <div className="relative">
              <Speaker className="pointer-events-none absolute right-3 top-9 h-4 w-4 text-slate-400" />
              <DeviceSelect label="Speaker" value={activeOutputDeviceId} devices={devices.speakers} onChange={setAudioOutputDeviceId} />
            </div>
          )}
        </div>

        {(mediaError || devices.error || joinError) && (
          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800" role="alert">
            {joinError || mediaError || devices.error}
          </div>
        )}

        <p className="mt-5 text-sm text-slate-500" aria-live="polite">
          {!devices.supported
            ? 'Media devices are unavailable in this browser.'
            : ready
              ? 'Camera and microphone are ready.'
              : 'You can join with unavailable devices turned off.'}
        </p>
        <button
          type="button"
          disabled={joining || !devices.supported}
          onClick={() => onJoin({
            audioEnabled,
            videoEnabled,
            audioDeviceId: activeAudioDeviceId,
            videoDeviceId: activeVideoDeviceId,
            audioOutputDeviceId: activeOutputDeviceId,
          })}
          className="btn-primary mt-5 w-full disabled:cursor-not-allowed disabled:opacity-50"
        >
          {joining ? 'Checking access…' : 'Join meeting'}
        </button>
      </section>
    </div>
  );
}
