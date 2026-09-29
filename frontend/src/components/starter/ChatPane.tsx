import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Bot, CheckCircle2, ChevronRight, Send, Sparkles, XCircle } from 'lucide-react';
import type { StarterMessage, StarterRun } from '../../api/starterApi';
import { Button } from '../common/Button';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { ChatMarkdown } from './ChatMarkdown';
import { QUICK_REPLIES, canGenerate, hasUserMessage } from './starterMeta';

interface ChatPaneProps {
  run: StarterRun | null;
  /** The user's message while the AI is answering (shown optimistically). */
  pending: string | null;
  error: string | null;
  noAi: boolean;
  generating: boolean;
  onSend: (text: string) => Promise<boolean>;
  onGenerate: () => Promise<void>;
}

const VersionList: React.FC<{ versions: NonNullable<StarterMessage['versions']> }> = ({ versions }) => (
  <details className="mt-2 group">
    <summary className="inline-flex items-center gap-1 text-[11px] font-medium text-violet-700 cursor-pointer select-none list-none">
      <ChevronRight size={12} className="transition-transform group-open:rotate-90" aria-hidden />
      Verified versions ({versions.length})
    </summary>
    <ul className="mt-1.5 pl-4 space-y-0.5 text-[11px] font-mono text-slate-600">
      {versions.map((v, i) => (
        <li key={`${v.ecosystem}-${v.name}-${i}`} className="flex items-center gap-1.5" title={v.notes || v.ecosystem}>
          {v.found ? (
            <CheckCircle2 size={11} className="text-emerald-600 shrink-0" aria-label="found" />
          ) : (
            <XCircle size={11} className="text-rose-600 shrink-0" aria-label="not found" />
          )}
          <span className="truncate">
            {v.name}@{v.found ? v.latest : 'not found'}
          </span>
          <span className="text-slate-400">({v.ecosystem})</span>
        </li>
      ))}
    </ul>
  </details>
);

const Bubble: React.FC<{ message: Pick<StarterMessage, 'role' | 'content' | 'versions'> }> = ({ message }) =>
  message.role === 'user' ? (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-lg rounded-br-sm bg-sky-600 text-white px-3 py-2 text-sm whitespace-pre-wrap break-words">
        {message.content}
      </div>
    </div>
  ) : (
    <div className="flex gap-2">
      <div className="w-7 h-7 rounded-md bg-violet-100 text-violet-700 flex items-center justify-center shrink-0" aria-hidden>
        <Bot size={15} />
      </div>
      <div className="max-w-[85%] min-w-0 rounded-lg rounded-tl-sm bg-slate-50 border border-slate-200 px-3 py-2">
        <ChatMarkdown source={message.content} />
        {message.versions && message.versions.length > 0 && <VersionList versions={message.versions} />}
      </div>
    </div>
  );

export const ChatPane: React.FC<ChatPaneProps> = ({ run, pending, error, noAi, generating, onSend, onGenerate }) => {
  const [text, setText] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const messages = run?.messages || [];
  const sending = pending !== null;
  const published = !!run?.repo || run?.status === 'published';
  const busy = run?.status === 'generating' || run?.status === 'publishing';
  const inputDisabled = sending || busy || published;
  const hasFiles = (run?.files.length || 0) > 0;
  const generateEnabled = canGenerate(run) && !sending && !generating;

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, pending]);

  const submit = async (value: string) => {
    const content = value.trim();
    if (!content || inputDisabled) return;
    setText('');
    const ok = await onSend(content);
    if (!ok) setText(content);
  };

  const generateTitle = !run
    ? 'Describe your project first'
    : published
      ? 'This project was already pushed to a repository'
      : busy
        ? 'Wait for the current step to finish'
        : !hasUserMessage(run)
          ? 'Send at least one message first'
          : undefined;

  if (noAi) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-6 flex flex-col items-center justify-center text-center min-h-[420px]">
        <div className="w-10 h-10 rounded-md bg-violet-100 text-violet-700 flex items-center justify-center mb-3">
          <Sparkles size={20} />
        </div>
        <h2 className="text-sm font-bold text-slate-800">Connect an AI provider first</h2>
        <p className="text-xs text-slate-500 max-w-sm mt-1 mb-4">
          The Project Starter uses your ChatGPT (OpenAI) connector to interview you and write the files. Add one, then come back here.
        </p>
        <Link to="/connectors?tab=ai" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-sky-600 text-white text-xs font-medium hover:bg-sky-700">
          Add an AI connector
        </Link>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white flex flex-col min-h-[420px] lg:h-[calc(100vh-11rem)]">
      <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-800 truncate">{run?.title || 'New project'}</h2>
        <Button
          size="sm"
          className="bg-violet-600! hover:bg-violet-700!"
          leftIcon={<Sparkles size={14} />}
          disabled={!generateEnabled}
          isLoading={generating}
          title={generateTitle}
          onClick={() => (hasFiles ? setConfirmOpen(true) : void onGenerate())}
        >
          {hasFiles ? 'Regenerate' : 'Generate project'}
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 max-h-[60vh] lg:max-h-none" aria-live="polite">
        {messages.length === 0 && !pending && (
          <div className="text-center py-8">
            <p className="text-sm font-medium text-slate-700">What are you building?</p>
            <p className="text-xs text-slate-500 mt-1">
              Describe the idea. The AI asks follow-up questions, then generates the files once you press Generate project.
            </p>
          </div>
        )}
        {messages.map((m, i) => (
          <Bubble key={`${m.at}-${i}`} message={m} />
        ))}
        {pending && <Bubble message={{ role: 'user', content: pending }} />}
        {sending && (
          <div className="flex items-center gap-2 text-xs text-slate-500" role="status">
            <div className="w-7 h-7 rounded-md bg-violet-100 text-violet-700 flex items-center justify-center" aria-hidden>
              <Bot size={15} />
            </div>
            <span className="inline-flex gap-1" aria-hidden>
              <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce" />
              <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce [animation-delay:150ms]" />
              <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce [animation-delay:300ms]" />
            </span>
            The AI is thinking and checking package versions (up to a minute)…
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 p-2.5 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs" role="alert">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            {error}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t border-slate-200 p-3 space-y-2">
        {!hasUserMessage(run) && !sending && (
          <div className="flex flex-wrap gap-1.5">
            {QUICK_REPLIES.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => void submit(q)}
                className="px-2.5 py-1 rounded-full border border-violet-200 bg-violet-50 text-violet-800 text-xs hover:bg-violet-100 cursor-pointer"
              >
                {q}
              </button>
            ))}
          </div>
        )}
        {run?.status === 'ready' && (
          <p className="text-[11px] text-slate-500">
            Files are ready. Sending another message moves the project back to chatting; press Regenerate afterwards to rebuild all files.
          </p>
        )}
        {published && <p className="text-[11px] text-slate-500">This project was pushed to a repository. Start a new project to generate another one.</p>}
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void submit(text);
              }
            }}
            rows={2}
            disabled={inputDisabled}
            aria-label="Message"
            placeholder="Describe your project, e.g. 'A task manager with a React frontend and a Python FastAPI backend using PostgreSQL'"
            className="flex-1 resize-y min-h-[44px] max-h-48 px-3 py-2 rounded-md border border-slate-300 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-100 focus:border-sky-500 disabled:bg-slate-100 disabled:cursor-not-allowed"
          />
          <Button
            aria-label="Send message"
            title={inputDisabled ? 'Wait for the current step to finish' : 'Send (Enter)'}
            disabled={inputDisabled || !text.trim()}
            isLoading={sending}
            onClick={() => void submit(text)}
          >
            <Send size={15} />
          </Button>
        </div>
        <p className="text-[10px] text-slate-400">Enter to send, Shift+Enter for a new line.</p>
      </div>

      <ConfirmDialog
        isOpen={confirmOpen}
        title="Regenerate project files?"
        message="This replaces the current files (including your edits) with a freshly generated set based on the whole conversation."
        confirmLabel="Regenerate"
        tone="primary"
        isLoading={generating}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          void onGenerate().finally(() => setConfirmOpen(false));
        }}
      />
    </section>
  );
};
