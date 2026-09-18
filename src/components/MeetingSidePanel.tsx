import { useEffect, useRef, useState } from 'react';
import { Crown, Hand, MessageSquare, MicOff, Send, UserMinus, Users, X } from 'lucide-react';
import { useParticipants, useSpeakingParticipants } from '@livekit/components-react';
import type { ChatMessage } from '../lib/data-access';
import { canUseHostControls, isActiveSpeaker } from '../lib/conference-utils';

export type MeetingPanel = 'participants' | 'chat' | null;

type MeetingSidePanelProps = {
  panel: MeetingPanel;
  hostId: string;
  currentUserId: string;
  messages: ChatMessage[];
  raisedHands: ReadonlySet<string>;
  sending: boolean;
  error: string | null;
  moderatingIdentity?: string | null;
  onClose: () => void;
  onSend: (message: string) => void;
  onModerate?: (identity: string, action: 'mute' | 'remove') => void;
  onDeleteMessage?: (messageId: string) => void;
  onClearHands?: () => void;
};

export default function MeetingSidePanel({
  panel,
  hostId,
  currentUserId,
  messages,
  raisedHands,
  sending,
  error,
  moderatingIdentity,
  onClose,
  onSend,
  onModerate,
  onDeleteMessage,
  onClearHands,
}: MeetingSidePanelProps) {
  const participants = useParticipants();
  const activeSpeakers = useSpeakingParticipants();
  const speakerIdentities = new Set(activeSpeakers.map((participant) => participant.identity));
  const canModerate = canUseHostControls(hostId, currentUserId);
  const [draft, setDraft] = useState('');
  const [participantFilter, setParticipantFilter] = useState('');
  const messageEnd = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (panel === 'chat') messageEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, panel]);

  if (!panel) return null;

  const filterNormalized = panel === 'participants' ? participantFilter.trim().toLowerCase() : '';
  const visibleParticipants = filterNormalized
    ? participants.filter((participant) => {
      const label = `${participant.name || ''} ${participant.identity}`.toLowerCase();
      return label.includes(filterNormalized);
    })
    : participants;

  return (
    <aside className="flex max-h-[42dvh] w-full min-h-0 shrink-0 flex-col overflow-hidden border-t border-slate-800 bg-slate-900 md:max-h-none md:w-96 md:border-l md:border-t-0" aria-label={panel === 'chat' ? 'Meeting chat' : 'Participants'}>
      <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
        <h2 className="flex items-center gap-2 font-semibold text-white">
          {panel === 'chat' ? <MessageSquare className="h-5 w-5" /> : <Users className="h-5 w-5" />}
          {panel === 'chat' ? 'In-call messages' : `Participants (${participants.length})`}
        </h2>
        <button onClick={onClose} className="rounded-full p-2 text-slate-400 hover:bg-slate-800 hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-400" aria-label="Close side panel">
          <X className="h-5 w-5" />
        </button>
      </div>

      {panel === 'participants' ? (
        <ul className="flex-1 space-y-2 overflow-y-auto p-4">
          {participants.length > 12 && (
            <li>
              <label className="block">
                <span className="sr-only">Filter participants</span>
                <input
                  type="search"
                  value={participantFilter}
                  onChange={(event) => setParticipantFilter(event.target.value)}
                  placeholder="Find a participant"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-400"
                  aria-label="Filter participants"
                />
              </label>
            </li>
          )}
          {canModerate && onClearHands && (
            <li>
              <button type="button" onClick={onClearHands} className="w-full rounded-xl border border-slate-700 px-3 py-2 text-left text-xs text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-400">
                Clear raised hands
              </button>
            </li>
          )}
          {visibleParticipants.length === 0 && (
            <li className="rounded-xl border border-dashed border-slate-700 px-3 py-6 text-center text-sm text-slate-400">
              No participants match that filter.
            </li>
          )}
          {visibleParticipants.map((participant) => (
            <li key={participant.identity} className="flex items-center justify-between gap-2 rounded-xl bg-slate-800/70 px-3 py-3 text-sm text-slate-200">
              <span className="min-w-0">
                <strong className="block truncate font-medium">{participant.name || participant.identity}</strong>
                <span className="text-xs text-slate-400">
                  {participant.isLocal ? 'You' : 'In the meeting'}
                  {isActiveSpeaker(participant.identity, speakerIdentities) ? ' · Speaking' : ''}
                  {!participant.isMicrophoneEnabled ? ' · Muted' : ''}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1">
                {raisedHands.has(participant.identity) && <Hand className="h-4 w-4 text-blue-400" aria-label="Hand raised" />}
                {participant.identity === hostId && <Crown className="h-4 w-4 text-amber-400" aria-label="Host" />}
                {canModerate && onModerate && !participant.isLocal && participant.identity !== hostId && (
                  <>
                    <button
                      type="button"
                      onClick={() => onModerate(participant.identity, 'mute')}
                      disabled={Boolean(moderatingIdentity)}
                      className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-950 text-white focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-40"
                      aria-label={`Mute ${participant.name || participant.identity}`}
                    >
                      <MicOff className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onModerate(participant.identity, 'remove')}
                      disabled={Boolean(moderatingIdentity)}
                      className="flex h-9 w-9 items-center justify-center rounded-full bg-red-600 text-white focus:outline-none focus:ring-2 focus:ring-red-300 disabled:opacity-40"
                      aria-label={`Remove ${participant.name || participant.identity}`}
                    >
                      <UserMinus className="h-4 w-4" />
                    </button>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <>
          <div className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
            {messages.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-400">
                No messages yet. Start the conversation.
              </div>
            )}
            {messages.map((message) => {
              const own = message.user_id === currentUserId;
              return (
                <div key={message.id} className={`flex ${own ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-2xl px-3 py-2 ${own ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-100'}`}>
                    <div className="flex items-center gap-2 text-[11px] opacity-75">
                      <span className="font-semibold">{own ? 'You' : message.user_name}</span>
                      <time dateTime={message.created_at}>{new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm">{message.message}</p>
                    {onDeleteMessage && (own || canModerate) && (
                      <button type="button" onClick={() => onDeleteMessage(message.id)} className="mt-1 text-[11px] opacity-75">Remove</button>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={messageEnd} />
          </div>
          <form
            className="border-t border-slate-800 p-4"
            onSubmit={(event) => {
              event.preventDefault();
              const message = draft.trim();
              if (!message || sending) return;
              onSend(message);
              setDraft('');
            }}
          >
            {error && <p className="mb-2 text-xs text-red-300" role="alert">{error}</p>}
            <div className="flex gap-2">
              <label className="sr-only" htmlFor="meeting-chat-message">Message</label>
              <input
                id="meeting-chat-message"
                value={draft}
                maxLength={2000}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Send a message"
                className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-500 focus:border-blue-500"
              />
              <button type="submit" disabled={!draft.trim() || sending} className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white disabled:opacity-40" aria-label="Send message">
                <Send className="h-4 w-4" />
              </button>
            </div>
          </form>
        </>
      )}
    </aside>
  );
}
