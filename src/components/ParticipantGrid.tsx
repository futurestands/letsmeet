import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Crown, Hand, MicOff, Pin, PinOff, UserMinus } from 'lucide-react';
import { ParticipantTile, useSpeakingParticipants, useTracks } from '@livekit/components-react';
import { RemoteTrackPublication, Track, VideoQuality } from 'livekit-client';
import {
  GALLERY_PAGE_SIZE,
  cameraSubscriptionIdentities,
  clampParticipantPage,
  compareParticipantTiles,
  isActiveSpeaker,
  pageIndexForIdentity,
  preferredRemoteVideoQuality,
  visibleParticipantRange,
} from '../lib/conference-utils';

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
  const [pinnedIdentity, setPinnedIdentity] = useState<string | null>(null);
  const manualPageUntil = useRef(0);
  const activeSpeakers = useSpeakingParticipants();
  const speakerIdentities = useMemo(
    () => new Set(activeSpeakers.map((participant) => participant.identity)),
    [activeSpeakers],
  );
  const cameraTracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }]);
  const screenShares = useTracks([Track.Source.ScreenShare], { onlySubscribed: false });

  const orderedTracks = useMemo(() => [...cameraTracks].sort((left, right) => compareParticipantTiles(
    {
      identity: left.participant.identity,
      isLocal: left.participant.isLocal,
      name: left.participant.name,
      speaking: speakerIdentities.has(left.participant.identity),
      pinned: pinnedIdentity === left.participant.identity,
    },
    {
      identity: right.participant.identity,
      isLocal: right.participant.isLocal,
      name: right.participant.name,
      speaking: speakerIdentities.has(right.participant.identity),
      pinned: pinnedIdentity === right.participant.identity,
    },
  )), [cameraTracks, pinnedIdentity, speakerIdentities]);

  const orderedIdentities = useMemo(
    () => orderedTracks.map((track) => track.participant.identity),
    [orderedTracks],
  );

  // Follow the primary active speaker onto their gallery page unless the user
  // recently paged manually or has pinned someone (spotlight mode).
  useEffect(() => {
    if (pinnedIdentity) return;
    if (Date.now() < manualPageUntil.current) return;
    const primarySpeaker = activeSpeakers.find((participant) => !participant.isLocal)?.identity
      ?? activeSpeakers[0]?.identity;
    if (!primarySpeaker) return;
    const speakerPage = pageIndexForIdentity(orderedIdentities, primarySpeaker);
    if (speakerPage === null || speakerPage === page) return;
    setPage(speakerPage);
  }, [activeSpeakers, orderedIdentities, page, pinnedIdentity]);

  const safePage = clampParticipantPage(page, orderedTracks.length);
  const range = visibleParticipantRange(safePage, orderedTracks.length);
  const visibleTracks = useMemo(() => {
    const pageTracks = orderedTracks.slice(range.start, range.end);
    if (!pinnedIdentity) return pageTracks;
    const pinnedTrack = orderedTracks.find((track) => track.participant.identity === pinnedIdentity);
    if (!pinnedTrack) return pageTracks;
    if (pageTracks.some((track) => track.participant.identity === pinnedIdentity)) return pageTracks;
    // Keep pin visible even when the user is browsing another page.
    return [pinnedTrack, ...pageTracks.slice(0, Math.max(0, GALLERY_PAGE_SIZE - 1))];
  }, [orderedTracks, pinnedIdentity, range.end, range.start]);

  const subscribedIdentities = useMemo(
    () => cameraSubscriptionIdentities({
      orderedIdentities,
      page: safePage,
      pinnedIdentity,
    }),
    [orderedIdentities, pinnedIdentity, safePage],
  );
  const pageCount = Math.max(1, Math.ceil(orderedTracks.length / GALLERY_PAGE_SIZE));

  useEffect(() => {
    cameraTracks.forEach((trackRef) => {
      if (!(trackRef.publication instanceof RemoteTrackPublication)) return;
      const identity = trackRef.participant.identity;
      const shouldSubscribe = subscribedIdentities.has(identity);
      void trackRef.publication.setSubscribed(shouldSubscribe);
      if (!shouldSubscribe) return;
      const quality = preferredRemoteVideoQuality({
        identity,
        pinnedIdentity,
        speakerIdentities,
        subscribedIdentities,
      });
      trackRef.publication.setVideoQuality(
        quality === 'high' ? VideoQuality.HIGH : VideoQuality.LOW,
      );
    });
  }, [cameraTracks, pinnedIdentity, speakerIdentities, subscribedIdentities]);

  // Screen shares must stay subscribed regardless of gallery pagination.
  useEffect(() => {
    screenShares.forEach((trackRef) => {
      if (trackRef.publication instanceof RemoteTrackPublication) {
        void trackRef.publication.setSubscribed(true);
      }
    });
  }, [screenShares]);

  const changePage = (next: number) => {
    manualPageUntil.current = Date.now() + 8_000;
    setPage(next);
  };

  const togglePin = (identity: string) => {
    setPinnedIdentity((current) => (current === identity ? null : identity));
  };

  return (
    <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-950" aria-label="Participant stage">
      {screenShares.length > 0 && (
        <div className="border-b border-slate-800 bg-black p-3" data-screen-share-stage="true">
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
          const speaking = isActiveSpeaker(identity, speakerIdentities);
          const microphoneMuted = !participant.isMicrophoneEnabled;
          const pinned = pinnedIdentity === identity;
          return (
            <div
              key={`${identity}-${trackRef.source}`}
              className={`group relative min-h-40 overflow-hidden rounded-2xl border bg-slate-900 ${
                pinned
                  ? 'border-blue-400 shadow-[0_0_0_2px_rgba(96,165,250,0.25)]'
                  : speaking
                    ? 'border-emerald-400 shadow-[0_0_0_2px_rgba(52,211,153,0.2)]'
                    : 'border-slate-800'
              }`}
              data-active-speaker={speaking ? 'true' : 'false'}
              data-pinned={pinned ? 'true' : 'false'}
              data-participant-identity={identity}
            >
              <ParticipantTile trackRef={trackRef} className="h-full w-full" />
              <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-2">
                {isHost && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/90 px-2 py-1 text-[11px] font-bold text-slate-950">
                    <Crown className="h-3 w-3" /> Host
                  </span>
                )}
                {pinned && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-blue-500 px-2 py-1 text-[11px] font-bold text-white">
                    <Pin className="h-3 w-3" /> Pinned
                  </span>
                )}
                {handRaised && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-blue-500 px-2 py-1 text-[11px] font-bold text-white">
                    <Hand className="h-3 w-3" /> Raised
                  </span>
                )}
                {speaking && (
                  <span className="inline-flex items-center rounded-full bg-emerald-500 px-2 py-1 text-[11px] font-bold text-slate-950">
                    Speaking
                  </span>
                )}
                {microphoneMuted && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-950/85 px-2 py-1 text-[11px] font-bold text-white">
                    <MicOff className="h-3 w-3" /> Muted
                  </span>
                )}
              </div>
              <div className="absolute bottom-3 right-3 flex gap-2 opacity-100 transition md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                <button
                  type="button"
                  onClick={() => togglePin(identity)}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-950/85 text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                  aria-label={pinned ? `Unpin ${participant.name || identity}` : `Pin ${participant.name || identity}`}
                  aria-pressed={pinned}
                  title={pinned ? 'Unpin participant' : 'Pin participant'}
                >
                  {pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                </button>
                {canModerate && !participant.isLocal && !isHost && (
                  <>
                    <button
                      type="button"
                      onClick={() => onModerate(identity, 'mute')}
                      className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-950/85 text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                      aria-label={`Mute ${participant.name || identity}`}
                      title="Mute participant"
                    >
                      <MicOff className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onModerate(identity, 'remove')}
                      className="flex h-9 w-9 items-center justify-center rounded-full bg-red-600 text-white focus:outline-none focus:ring-2 focus:ring-red-300"
                      aria-label={`Remove ${participant.name || identity}`}
                      title="Remove participant"
                    >
                      <UserMinus className="h-4 w-4" />
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {pageCount > 1 && (
        <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-slate-900/95 px-2 py-1 text-xs text-white shadow-lg" role="navigation" aria-label="Participant pages">
          <button
            type="button"
            onClick={() => changePage(Math.max(0, safePage - 1))}
            disabled={safePage === 0}
            className="rounded-full p-2 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-30"
            aria-label="Previous participant page"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span aria-live="polite">{safePage + 1} / {pageCount}</span>
          <button
            type="button"
            onClick={() => changePage(Math.min(pageCount - 1, safePage + 1))}
            disabled={safePage === pageCount - 1}
            className="rounded-full p-2 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-30"
            aria-label="Next participant page"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </section>
  );
});

export default ParticipantGrid;
