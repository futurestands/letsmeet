import { useCallback, useEffect, useMemo, useState } from 'react';

export type MediaDeviceState = {
  cameras: MediaDeviceInfo[];
  microphones: MediaDeviceInfo[];
  speakers: MediaDeviceInfo[];
  supported: boolean;
  outputSelectionSupported: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

export function useMediaDevices(): MediaDeviceState {
  const supported = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.enumerateDevices);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!supported) {
      setError('This browser does not support media device discovery.');
      return;
    }
    try {
      const nextDevices = await navigator.mediaDevices.enumerateDevices();
      setDevices(nextDevices);
      setError(null);
    } catch {
      setError('Media devices could not be listed.');
    }
  }, [supported]);

  useEffect(() => {
    if (!supported) return undefined;
    const timer = window.setTimeout(() => {
      void refresh();
    }, 0);
    navigator.mediaDevices.addEventListener('devicechange', refresh);
    return () => {
      window.clearTimeout(timer);
      navigator.mediaDevices.removeEventListener('devicechange', refresh);
    };
  }, [refresh, supported]);

  return useMemo(() => ({
    cameras: devices.filter((device) => device.kind === 'videoinput'),
    microphones: devices.filter((device) => device.kind === 'audioinput'),
    speakers: devices.filter((device) => device.kind === 'audiooutput'),
    supported,
    outputSelectionSupported:
      typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype,
    error,
    refresh,
  }), [devices, error, refresh, supported]);
}
