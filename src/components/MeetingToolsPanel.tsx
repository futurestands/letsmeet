import { useCallback, useEffect, useRef, useState } from 'react';
import {
  appendWhiteboardOp,
  askMeetingQuestion,
  closeMeetingPoll,
  createMeetingPoll,
  ensureWhiteboardPage,
  listMeetingAiJobs,
  listMeetingPolls,
  listMeetingQuestions,
  listMeetingRecordings,
  listPollOptions,
  listWhiteboardOps,
  loadMeetingNotes,
  moderateMeetingQuestion,
  requestMeetingAiJob,
  requestMeetingRecording,
  saveMeetingNotes,
  upvoteMeetingQuestion,
  voteMeetingPoll,
  type MeetingAiJob,
  type MeetingNotes,
  type MeetingPoll,
  type MeetingPollOption,
  type MeetingQuestion,
  type MeetingRecording,
  type WhiteboardOp,
  type WhiteboardPage,
} from '../lib/data-access';
import { aiJobStatusLabel, canCreatePoll, recordingStatusLabel, replayWhiteboardOps, sanitizePollOptions } from '../lib/collaboration-utils';
import { supabase } from '../lib/supabase';

type ToolsTab = 'polls' | 'qa' | 'notes' | 'board' | 'intel';

type MeetingToolsPanelProps = {
  meetingId: string;
  isHost: boolean;
  tokenEndpoint: string;
};

export default function MeetingToolsPanel({ meetingId, isHost, tokenEndpoint }: MeetingToolsPanelProps) {
  const [tab, setTab] = useState<ToolsTab>('polls');
  const [error, setError] = useState<string | null>(null);
  const [polls, setPolls] = useState<MeetingPoll[]>([]);
  const [optionsByPoll, setOptionsByPoll] = useState<Record<string, MeetingPollOption[]>>({});
  const [questions, setQuestions] = useState<MeetingQuestion[]>([]);
  const [notes, setNotes] = useState<MeetingNotes | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [questionDraft, setQuestionDraft] = useState('');
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState('Yes\nNo');
  const [anonymousPoll, setAnonymousPoll] = useState(false);
  const [recordings, setRecordings] = useState<MeetingRecording[]>([]);
  const [aiJobs, setAiJobs] = useState<MeetingAiJob[]>([]);
  const [qaPrompt, setQaPrompt] = useState('');
  const [page, setPage] = useState<WhiteboardPage | null>(null);
  const [ops, setOps] = useState<WhiteboardOp[]>([]);
  const [qaFilter, setQaFilter] = useState<'all' | 'open' | 'answered'>('all');

  const reload = useCallback(async () => {
    const [pollRows, questionRows, noteRow, recordingRows, aiRows] = await Promise.all([
      listMeetingPolls(meetingId),
      listMeetingQuestions(meetingId),
      loadMeetingNotes(meetingId),
      listMeetingRecordings(meetingId),
      listMeetingAiJobs(meetingId),
    ]);
    setPolls(pollRows);
    setQuestions(questionRows);
    setNotes(noteRow);
    setNoteDraft(noteRow?.content ?? '');
    setRecordings(recordingRows);
    setAiJobs(aiRows);
    const optionEntries = await Promise.all(pollRows.map(async (poll) => [poll.id, await listPollOptions(poll.id)] as const));
    setOptionsByPoll(Object.fromEntries(optionEntries));
  }, [meetingId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void reload().catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Collaboration tools could not load.'));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [reload, tab]);

  useEffect(() => {
    const channel = supabase
      .channel(`collab:${meetingId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meeting_polls', filter: `meeting_id=eq.${meetingId}` }, () => {
        void reload().catch(() => undefined);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meeting_questions', filter: `meeting_id=eq.${meetingId}` }, () => {
        void reload().catch(() => undefined);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meeting_notes', filter: `meeting_id=eq.${meetingId}` }, () => {
        void reload().catch(() => undefined);
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [meetingId, reload]);

  useEffect(() => {
    if (tab !== 'board') return undefined;
    let active = true;
    const timer = window.setTimeout(() => {
      void ensureWhiteboardPage(meetingId)
        .then(async (nextPage) => {
          if (!active) return;
          setPage(nextPage);
          setOps(await listWhiteboardOps(nextPage.id));
        })
        .catch((boardError) => setError(boardError instanceof Error ? boardError.message : 'Whiteboard could not load.'));
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [meetingId, tab]);

  const startRecording = async () => {
    setError(null);
    try {
      const recording = await requestMeetingRecording(meetingId);
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) throw new Error('Session expired');
      const startUrl = tokenEndpoint.replace(/\/livekit\/token(?:\?.*)?$/, '/recordings/start');
      const response = await fetch(startUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordingId: recording.id }),
      });
      const payload = await response.json() as { error?: string; status?: string };
      if (!response.ok) {
        setError(payload.error || 'Recording stayed queued because egress is not configured.');
      }
      await reload();
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : 'Recording could not be requested.');
    }
  };

  const stopRecording = async (recordingId: string) => {
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) throw new Error('Session expired');

      const stopUrl = tokenEndpoint.replace(/\/livekit\/token(?:\?.*)?$/, '/recordings/stop');
      const response = await fetch(stopUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordingId }),
      });

      const payload = await response.json() as { error?: string; status?: string };
      if (!response.ok) {
        setError(payload.error || 'Recording could not be stopped.');
      }
      await reload();
    } catch (stopError) {
      setError(stopError instanceof Error ? stopError.message : 'Recording could not be stopped.');
    }
  };

  const visibleQuestions = questions.filter((question) => qaFilter === 'all' || question.status === qaFilter);

  return (
    <aside className="flex max-h-[42dvh] w-full min-h-0 shrink-0 flex-col overflow-hidden border-t border-slate-800 bg-slate-900 md:max-h-none md:w-96 md:border-l md:border-t-0">
      <div className="flex gap-1 overflow-x-auto border-b border-slate-800 px-3 py-2 text-xs">
        {([['polls', 'Polls'], ['qa', 'Q&A'], ['notes', 'Notes'], ['board', 'Board'], ['intel', 'Intel']] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            aria-label={label}
            aria-pressed={tab === id}
            className={`rounded-full px-3 py-1 ${tab === id ? 'bg-blue-600 text-white' : 'text-slate-300'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 text-sm text-slate-200">
        {error && <p className="mb-3 text-xs text-amber-300" role="alert">{error}</p>}

        {tab === 'polls' && (
          <div className="space-y-4">
            {isHost && (
              <form
                className="space-y-2 rounded-xl border border-slate-800 p-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  const options = sanitizePollOptions(pollOptions.split('\n'));
                  if (!canCreatePoll(options, pollQuestion)) return;
                  void createMeetingPoll(meetingId, pollQuestion, options, anonymousPoll)
                    .then(() => { setPollQuestion(''); void reload(); })
                    .catch((pollError) => setError(pollError instanceof Error ? pollError.message : 'Poll could not be created.'));
                }}
              >
                <input value={pollQuestion} onChange={(event) => setPollQuestion(event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" placeholder="Poll question" />
                <textarea value={pollOptions} onChange={(event) => setPollOptions(event.target.value)} className="min-h-20 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" placeholder="One option per line" />
                <label className="flex items-center gap-2 text-xs text-slate-400">
                  <input type="checkbox" checked={anonymousPoll} onChange={(event) => setAnonymousPoll(event.target.checked)} />
                  Anonymous votes
                </label>
                <button type="submit" className="rounded-lg bg-blue-600 px-3 py-2 text-white" aria-label="Create poll">Create poll</button>
              </form>
            )}
            {polls.length === 0 && <p className="text-slate-400">No polls yet.</p>}
            {polls.map((poll) => (
              <div key={poll.id} className="rounded-xl border border-slate-800 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <strong>{poll.question}</strong>
                    <p className="text-xs text-slate-400">{poll.status}{poll.anonymous ? ' · anonymous' : ''}</p>
                  </div>
                  {isHost && poll.status === 'open' && (
                    <button onClick={() => void closeMeetingPoll(poll.id).then(() => reload())} className="text-xs text-amber-300">Close</button>
                  )}
                </div>
                <ul className="mt-2 space-y-1">
                  {(optionsByPoll[poll.id] ?? []).map((option) => (
                    <li key={option.id}>
                      <button
                        disabled={poll.status !== 'open'}
                        onClick={() => void voteMeetingPoll(poll.id, option.id).then(() => reload()).catch((voteError) => setError(voteError instanceof Error ? voteError.message : 'Vote failed.'))}
                        className="w-full rounded-lg bg-slate-800 px-3 py-2 text-left disabled:opacity-50"
                      >
                        {option.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        {tab === 'qa' && (
          <div className="space-y-3">
            <div className="flex gap-2 text-xs">
              {(['all', 'open', 'answered'] as const).map((value) => (
                <button key={value} onClick={() => setQaFilter(value)} className={qaFilter === value ? 'text-white' : 'text-slate-400'}>{value}</button>
              ))}
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!questionDraft.trim()) return;
                void askMeetingQuestion(meetingId, questionDraft)
                  .then(() => { setQuestionDraft(''); void reload(); })
                  .catch((askError) => setError(askError instanceof Error ? askError.message : 'Question could not be submitted.'));
              }}
            >
              <input value={questionDraft} onChange={(event) => setQuestionDraft(event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" placeholder="Ask a question" />
            </form>
            {visibleQuestions.length === 0 && <p className="text-slate-400">No questions yet.</p>}
            {visibleQuestions.map((question) => (
              <div key={question.id} className="rounded-xl border border-slate-800 p-3">
                <p>{question.body}</p>
                <p className="mt-1 text-xs text-slate-400">{question.user_name} · {question.status} · {question.upvote_count} votes</p>
                <div className="mt-2 flex gap-2 text-xs">
                  <button onClick={() => void upvoteMeetingQuestion(question.id).then(() => reload())}>Upvote</button>
                  {isHost && question.status !== 'answered' && (
                    <button onClick={() => void moderateMeetingQuestion(question.id, 'answered').then(() => reload())}>Mark answered</button>
                  )}
                  {isHost && question.status !== 'dismissed' && (
                    <button onClick={() => void moderateMeetingQuestion(question.id, 'dismissed').then(() => reload())}>Dismiss</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'notes' && (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void saveMeetingNotes(meetingId, noteDraft, notes?.version ?? 0)
                .then((saved) => {
                  setNotes(saved);
                  setNoteDraft(saved.content);
                  setError(null);
                })
                .catch(async (noteError) => {
                  const message = noteError instanceof Error ? noteError.message : 'Notes could not be saved.';
                  setError(message);
                  if (/someone else|updated by|version|conflict|stale/i.test(message)) {
                    try {
                      const latest = await loadMeetingNotes(meetingId);
                      if (latest) {
                        setNotes(latest);
                        setNoteDraft(latest.content);
                        setError('Notes were updated by someone else. Your draft was replaced with the latest server version. Re-apply your edits and save again.');
                      }
                    } catch {
                      // keep original error
                    }
                  }
                });
            }}
          >
            <textarea
              value={noteDraft}
              onChange={(event) => setNoteDraft(event.target.value)}
              className="min-h-48 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
              placeholder="Shared notes are saved on the server."
              aria-label="Shared meeting notes"
            />
            <div className="flex flex-wrap gap-2">
              <button type="submit" className="rounded-lg bg-blue-600 px-3 py-2 text-white" aria-label="Save notes">Save notes</button>
              <button
                type="button"
                className="rounded-lg border border-slate-600 px-3 py-2"
                aria-label="Reload notes from server"
                onClick={() => {
                  void loadMeetingNotes(meetingId)
                    .then((latest) => {
                      setNotes(latest);
                      setNoteDraft(latest?.content ?? '');
                      setError(null);
                    })
                    .catch((reloadError) => setError(reloadError instanceof Error ? reloadError.message : 'Notes could not be reloaded.'));
                }}
              >
                Reload
              </button>
            </div>
            {notes && <p className="text-xs text-slate-500">Version {notes.version}. Concurrent edits use optimistic locking — stale saves are rejected.</p>}
          </form>
        )}

        {tab === 'board' && page && (
          <WhiteboardCanvas
            ops={ops}
            onOp={(op) => {
              void appendWhiteboardOp(page.id, op)
                .then((saved) => setOps((current) => [...current, saved]))
                .catch((boardError) => setError(boardError instanceof Error ? boardError.message : 'Stroke could not be saved.'));
            }}
          />
        )}

        {tab === 'intel' && (
          <div className="space-y-4">
            {isHost && (
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void startRecording()} className="rounded-lg bg-red-600 px-3 py-2 text-white" aria-label="Start recording">Start recording</button>
                {recordings[0] && ['queued', 'starting', 'active'].includes(recordings[0].status) && (
                  <button type="button" onClick={() => void stopRecording(recordings[0].id)} className="rounded-lg border border-slate-600 px-3 py-2">Stop</button>
                )}
              </div>
            )}
            <ul className="space-y-2">
              {recordings.length === 0 && <li className="text-slate-400">No recordings. Nothing is marked complete unless LiveKit egress finishes.</li>}
              {recordings.map((recording) => (
                <li key={recording.id} className="rounded-xl border border-slate-800 p-3">
                  <strong>{recordingStatusLabel(recording.status)}</strong>
                  {recording.playback_url ? <a className="mt-1 block text-blue-300" href={recording.playback_url}>Play recording</a> : <p className="text-xs text-slate-400">Playback appears after storage completes.</p>}
                  {recording.error && <p className="text-xs text-amber-300">{recording.error}</p>}
                </li>
              ))}
            </ul>
            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                void requestMeetingAiJob(meetingId, qaPrompt.trim() ? 'transcript_qa' : 'summary', qaPrompt.trim() || undefined)
                  .then(() => { setQaPrompt(''); void reload(); })
                  .catch((aiError) => setError(aiError instanceof Error ? aiError.message : 'AI job could not be queued.'));
              }}
            >
              <input value={qaPrompt} onChange={(event) => setQaPrompt(event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" placeholder="Ask the transcript, or leave blank for a summary" />
              <button className="rounded-lg bg-blue-600 px-3 py-2 text-white">Queue AI job</button>
            </form>
            <ul className="space-y-2">
              {aiJobs.map((job) => (
                <li key={job.id} className="rounded-xl border border-slate-800 p-3">
                  <strong>{job.job_type}</strong>
                  <p className="text-xs text-slate-400">{aiJobStatusLabel(job.status)}</p>
                  {job.error && <p className="text-xs text-amber-300">{job.error}</p>}
                  {job.result && <pre className="mt-2 overflow-x-auto text-xs">{JSON.stringify(job.result, null, 2)}</pre>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </aside>
  );
}

function WhiteboardCanvas({
  ops,
  onOp,
}: {
  ops: WhiteboardOp[];
  onOp: (op: { type: string; points?: number[][]; color?: string }) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stroke = useRef<number[][]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.fillStyle = '#0f172a';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const visible = replayWhiteboardOps(ops);
    context.strokeStyle = '#93c5fd';
    context.lineWidth = 2;
    for (const item of visible) {
      const points = item.points ?? [];
      if (item.type !== 'stroke' || points.length < 2) continue;
      context.beginPath();
      context.moveTo(points[0][0], points[0][1]);
      for (const point of points.slice(1)) context.lineTo(point[0], point[1]);
      context.stroke();
    }
  }, [ops]);

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        width={640}
        height={360}
        className="w-full rounded-xl border border-slate-700 bg-slate-950"
        aria-label="Meeting whiteboard"
        role="img"
        onPointerDown={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          stroke.current = [[event.clientX - bounds.left, event.clientY - bounds.top]];
        }}
        onPointerMove={(event) => {
          if (event.buttons !== 1) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          stroke.current.push([event.clientX - bounds.left, event.clientY - bounds.top]);
        }}
        onPointerUp={() => {
          if (stroke.current.length > 1) onOp({ type: 'stroke', points: stroke.current, color: '#93c5fd' });
          stroke.current = [];
        }}
      />
      <div className="flex gap-2 text-xs">
        <button type="button" onClick={() => onOp({ type: 'undo' })} aria-label="Undo last stroke">Undo</button>
        <button type="button" onClick={() => onOp({ type: 'redo' })} aria-label="Redo last stroke">Redo</button>
        <button type="button" onClick={() => onOp({ type: 'clear' })} aria-label="Clear whiteboard">Clear</button>
      </div>
    </div>
  );
}
