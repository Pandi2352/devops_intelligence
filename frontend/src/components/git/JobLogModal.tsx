import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, ExternalLink, Loader2, Search, Terminal } from 'lucide-react';
import { Modal } from '../common/Modal';
import { gitApi, JobTrace, JobTraceLine } from '../../api/gitApi';
import { getApiErrorMessage } from '../../api/client';
import { PipelineStage } from '../../types';
import { JobReports } from './JobReports';

interface JobLogModalProps {
  integrationId: string;
  repoId: string | number;
  pipelineId: number;
  job: PipelineStage;
  onClose: () => void;
}

const POLL_MS = 3000;

const STATUS_STYLE: Record<string, string> = {
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  failed: 'bg-rose-50 text-rose-700 border-rose-200',
  running: 'bg-sky-50 text-sky-700 border-sky-200',
  pending: 'bg-amber-50 text-amber-800 border-amber-200',
  canceled: 'bg-slate-100 text-slate-600 border-slate-200',
};

// Colour a log line the way GitLab does: commands, failures, and the final verdict stand out.
const lineTone = (line: JobTraceLine) => {
  const t = line.text;
  if (/^\$ /.test(t)) return 'text-sky-300 font-semibold';
  if (/^Job succeeded/.test(t)) return 'text-emerald-400 font-semibold';
  if (/^(ERROR:|Job failed)|npm ERR!|✖|\bnot ok\b|^\s*fail [1-9]/i.test(t)) return 'text-rose-400';
  if (/^(WARNING:|npm warn)/i.test(t)) return 'text-amber-300';
  if (/^✔|^\s*pass \d/.test(t)) return 'text-emerald-300';
  return line.stream === 'err' ? 'text-slate-400' : 'text-slate-200';
};

const timeOf = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString([], { hour12: false }) : '');

// Real GitLab job log. Polls while the job is still running and follows the tail
// unless the user has scrolled up to read.
export const JobLogModal: React.FC<JobLogModalProps> = ({ integrationId, repoId, pipelineId, job, onClose }) => {
  const [trace, setTrace] = useState<JobTrace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [tab, setTab] = useState<'log' | 'reports'>('log');
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const followTail = useRef(true);

  const load = useCallback(async () => {
    try {
      setTrace(await gitApi.getJobTrace(integrationId, repoId, job.id!));
      setError(null);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not load the job log'));
    }
  }, [integrationId, repoId, job.id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!trace || trace.complete) return;
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [trace, load]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && followTail.current) el.scrollTop = el.scrollHeight;
  }, [trace]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (el) followTail.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  const visible = useMemo(() => {
    const lines = (trace?.lines || []).map((line, index) => ({ line, number: index + 1 }));
    const needle = filter.trim().toLowerCase();
    return needle ? lines.filter(({ line }) => line.text.toLowerCase().includes(needle)) : lines;
  }, [trace, filter]);

  const copyLog = async () => {
    try {
      await navigator.clipboard.writeText((trace?.lines || []).map((l) => l.text).join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const info = trace?.job;
  const status = info?.status || job.status;

  return (
    <Modal
      isOpen
      onClose={onClose}
      maxWidth="xl"
      title={`${job.name} · pipeline #${pipelineId}`}
      subtitle={info?.runner ? `Runner: ${info.runner}` : `Stage: ${job.stage || job.name}`}
      icon={
        <div className="w-9 h-9 rounded-md bg-slate-900 text-emerald-400 flex items-center justify-center">
          <Terminal size={18} />
        </div>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`px-2 py-0.5 rounded border font-semibold uppercase text-[10px] ${STATUS_STYLE[status] || STATUS_STYLE.canceled}`}>
              {status}
            </span>
            <span className="text-slate-600">
              Duration <strong className="text-slate-900">{info?.duration || job.duration || '-'}</strong>
            </span>
            {info?.failureReason && <span className="text-rose-700">Reason: {info.failureReason.replace(/_/g, ' ')}</span>}
            {trace && !trace.complete && (
              <span className="inline-flex items-center gap-1 text-sky-700">
                <Loader2 size={12} className="animate-spin" /> Live
              </span>
            )}
          </div>
          <div className={`flex items-center gap-1.5 ${tab === 'log' ? '' : 'invisible'}`}>
            <div className="relative">
              <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                type="search"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter lines, e.g. error"
                aria-label="Filter log lines"
                className="h-8 w-40 pl-7 pr-2 rounded-md border border-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-sky-100 focus:border-sky-500"
              />
            </div>
            <button
              type="button"
              onClick={copyLog}
              disabled={!trace}
              className="h-8 px-2.5 inline-flex items-center gap-1 rounded-md border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
            >
              {copied ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            {(info?.webUrl || job.webUrl) && (
              <a
                href={info?.webUrl || job.webUrl}
                target="_blank"
                rel="noreferrer"
                className="h-8 px-2.5 inline-flex items-center gap-1 rounded-md border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                GitLab <ExternalLink size={12} />
              </a>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 border-b border-slate-200" role="tablist" aria-label="Job output">
          {([
            ['log', 'Log'],
            ['reports', 'Reports'],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`px-3 py-1.5 -mb-px border-b-2 text-xs font-semibold cursor-pointer ${
                tab === id ? 'border-sky-600 text-sky-700' : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {error && tab === 'log' && (
          <div className="p-3 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs" role="alert">
            {error}
          </div>
        )}

        {tab === 'reports' ? (
          job.id ? <JobReports integrationId={integrationId} repoId={repoId} jobId={job.id} /> : null
        ) : (
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="h-[55vh] overflow-auto rounded-md bg-slate-950 border border-slate-800 py-2 font-mono text-[11px] leading-5 custom-scrollbar"
          role="log"
          aria-live="off"
        >
          {!trace && !error ? (
            <div className="flex items-center gap-2 px-4 py-3 text-slate-400">
              <Loader2 size={14} className="animate-spin" /> Loading log…
            </div>
          ) : trace && trace.lines.length === 0 ? (
            <div className="px-4 py-3 text-slate-400">No output yet. The job may still be waiting for a runner.</div>
          ) : (
            <>
              {trace?.truncated && <div className="px-4 pb-1 text-amber-300">… earlier output truncated; open in GitLab for the full log</div>}
              {visible.map(({ line, number }) => (
                <div key={number} className="flex hover:bg-slate-900/80">
                  <span className="w-10 shrink-0 pr-2 text-right text-slate-600 select-none">{number}</span>
                  {line.time && <span className="w-16 shrink-0 text-slate-600 select-none">{timeOf(line.time)}</span>}
                  <span className={`whitespace-pre-wrap break-all pr-4 ${lineTone(line)}`}>{line.text || ' '}</span>
                </div>
              ))}
              {filter && visible.length === 0 && <div className="px-4 py-2 text-slate-400">No lines match “{filter}”.</div>}
            </>
          )}
        </div>
        )}
      </div>
    </Modal>
  );
};
