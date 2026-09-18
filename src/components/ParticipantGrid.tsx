import { memo, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Crown, Hand, MicOff, UserMinus } from 'lucide-react';
import { ParticipantTile, useSpeakingParticipants, useTracks } from '@livekit/components-react';
import { RemoteTrackPublication, Track } from 'livekit-client';
import { clampParticipantPage, visibleParticipantRange } from '../lib/conference-utils';

type ParticipantGridProps = {
  hostId: string;
  raisedHands: ReadonlySet<string>;
  canModerate: boolean;
  onModerate: (identity: string, action: 'mute' | 'remove') => void;
};

function gridColumns(count: number): string {
  if (count <= 1) return 'grid-cols-1';
  if (count <= 4) return 'grid-cols-1 sm:grid-cols-2';
  if (count <= 9) return 'grid-cols-2 lg:grid-cols-3';
  return 'grid-cols-2 md:grid-cols-3 xl:grid-cols-4';
}

const ParticipantGrid = memo(function ParticipantGrid({
  hostId,
  raisedHands,
  canModerate,
  onModerate,
}: ParticipantGridProps) {
  const [page, setPage] = useState(0);
  const activeSpeakers = useSpeakingParticipants();
  const dominantIdentity = activeSpeakers[0]?.identity;
  const cameraTracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }]);
  const screenShares = useTracks([Track.Source.ScreenShare], { onlySubscribed: true });

  const orderedTracks = useMemo(() => [...cameraTracks].sort((left, right) => {
    if (left.participant.identity === dominantIdentity) return -1;
    if (right.participant.identity === dominantIdentity) return 1;
    if (left.participant.isLocal) return -1;
    if (right.participant.isLocal) return 1;
    return (left.participant.name || left.participant.identity)
      .localeCompare(right.participant.name || right.participant.identity);
  }), [cameraTracks, dominantIdentity]);

  const safePage = clampParticipantPage(page, orderedTracks.length);
  const range = visibleParticipantRange(safePage, orderedTracks.length);
  const visibleTracks = orderedTracks.slice(range.start, range.end);
  const visibleIdentities = useMemo(
    () => new Set(orderedTracks.slice(range.start, range.end).map((track) => track.participant.identity)),
    [orderedTracks, range.end, range.start],
  );
  const pageCount = Math.max(1, Math.ceil(orderedTracks.length / 16));

  useEffect(() => {
    cameraTracks.forEach((trackRef) => {
      if (trackRef.publication instanceof RemoteTrackPublication) {
        void trackRef.publication.setSubscribed(visibleIdentities.has(trackRef.participant.identity));
      }
    });
  }, [cameraTracks, visibleIdentities]);

  return (
    <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-950" aria-label="Participant stage">
      {screenShares.length > 0 && (
        <div className="border-b border-slate-800 bg-black p-3">
          <div className="mx-auto aspect-video max-h-[56vh] max-w-5xl overflow-hidden rounded-2xl border border-blue-400/40">
            <ParticipantTile trackRef={screenShares[0]} className="h-full w-full" />
          </div>
          <p className="mt-2 text-center text-xs text-blue-200">
            {screenShares[0].participant.name || 'Participant'} is presenting
          </p>
        </div>
      )}

      <div className={`grid min-h-0 flex-1 auto-rows-fr gap-3 overflow-y-auto p-3 sm:p-4 ${gridColumns(visibleTracks.length)}`}>
        {visibleTracks.map((trackRef) => {
          const participant = trackRef.participant;
          const identity = participant.identity;
          const isHost = identity === hostId;
          const handRaised = raisedHands.has(identity);
          return (
            <div
              key={`${identity}-${trackRef.source}`}
              className={`group relative min-h-40 overflow-hidden rounded-2xl border bg-slate-900 ${
                identity === dominantIdentity ? 'border-emerald-400 shadow-[0_0_0_2px_rgba(52,211,153,0.2)]' : 'border-slate-800'
              }`}
            >
              <ParticipantTile trackRef={trackRef} className="h-full w-full" />
              <div className="pointer-events-none absolute left-3 top-3 flex gap-2">
                {isHost && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/90 px-2 py-1 text-[11px] font-bold text-slate-950">
                    <Crown className="h-3 w-3" /> Host
                  </span>
                )}
                {handRaised && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-blue-500 px-2 py-1 text-[11px] font-bold text-white">
                    <Hand className="h-3 w-3" /> Raised
                  </span>
                )}
              </div>
              {canModerate && !participant.isLocal && !isHost && (
                <div className="absolute right-3 top-3 flex gap-2 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
                  <button
                    onClick={() => onModerate(identity, 'mute')}
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-950/85 text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                    aria-label={`Mute ${participant.name || identity}`}
                    title="Mute participant"
                  >
                    <MicOff className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => onModerate(identity, 'remove')}
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-red-600 text-white focus:outline-none focus:ring-2 focus:ring-red-300"
                    aria-label={`Remove ${participant.name || identity}`}
                    title="Remove participant"
                  >
                    <UserMinus className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {pageCount > 1 && (
        <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-slate-900/95 px-2 py-1 text-xs text-white shadow-lg">
          <button onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={safePage === 0} className="rounded-full p-2 disabled:opacity-30" aria-label="Previous participant page">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span>{safePage + 1} / {pageCount}</span>
          <button onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))} disabled={safePage === pageCount - 1} className="rounded-full p-2 disabled:opacity-30" aria-label="Next participant page">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </section>
  );
});

export default ParticipantGrid;
