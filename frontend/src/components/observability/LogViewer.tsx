import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownToLine,
  Clock,
  Copy,
  Download,
  History,
  Pause,
  Play,
  RefreshCw,
  Search,
  Trash2,
  WrapText,
  X,
} from 'lucide-react';
import { Button } from '../common/Button';
import { Dropdown } from '../common/Dropdown';
import { LogLine, observabilityApi } from '../../api/observabilityApi';
import { getApiErrorMessage } from '../../api/client';
import { LogLevel, SINCE_OPTIONS, logLevel, podColor, shortPod } from '../../utils/observability';

export interface LogViewerProps {
  cluster?: string;
  namespace: string;
  pods: string[]; // empty = every pod in the namespace
  container: string; // 'all' or a name
  lokiAvailable?: boolean;
  height?: string; // tailwind height class for the log area
  defaultPrevious?: boolean;
  compact?: boolean;
}

type Source = 'live' | 'history';
type LevelFilter = 'all' | 'error' | 'warn';

const MAX_LINES = 10000;
const TAIL_OPTIONS = ['100', '500', '1000', '5000'].map((v) => ({ value: v, label: `Last ${v} lines` }));
const LEVEL_OPTIONS = [
  { value: 'all', label: 'All levels' },
  { value: 'warn', label: 'Warnings + errors' },
  { value: 'error', label: 'Errors only' },
];
const LEVEL_CLASS: Record<LogLevel, string> = {
  error: 'text-rose-300',
  warn: 'text-amber-200',
  info: 'text-slate-200',
  debug: 'text-slate-500',
  '': 'text-slate-200',
};

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const Highlight: React.FC<{ text: string; pattern: RegExp | null }> = ({ text, pattern }) => {
  if (!pattern) return <>{text}</>;
  const parts = text.split(pattern);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="bg-amber-300 text-slate-900 rounded-sm px-0.5">
            {part}
          </mark>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        )
      )}
    </>
  );
};

// Terminal-style viewer for one or many pods: tail or time range, previous container, live follow,
// search with highlight, level filter, Loki history, copy and download.
export const LogViewer: React.FC<LogViewerProps> = ({
  cluster,
  namespace,
  pods,
  container,
  lokiAvailable = false,
  height = 'h-[60vh]',
  defaultPrevious = false,
  compact = false,
}) => {
  const [source, setSource] = useState<Source>('live');
  const [tail, setTail] = useState('500');
  const [since, setSince] = useState('');
  const [previous, setPrevious] = useState(defaultPrevious);
  const [follow, setFollow] = useState(false);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [streamState, setStreamState] = useState<'off' | 'connecting' | 'live' | 'ended'>('off');
  const [search, setSearch] = useState('');
  const [useRegex, setUseRegex] = useState(false);
  const [onlyMatches, setOnlyMatches] = useState(true);
  const [level, setLevel] = useState<LevelFilter>('all');
  const [wrap, setWrap] = useState(true);
  const [showTime, setShowTime] = useState(!compact);
  const [atBottom, setAtBottom] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const [historyQuery, setHistoryQuery] = useState('');

  const scrollRef = useRef<HTMLDivElement>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const atBottomRef = useRef(true);
  const podsKey = pods.join(',');

  const request = useMemo(
    () => ({ cluster, namespace, pods: podsKey ? podsKey.split(',') : [], container, tailLines: Number(tail), sinceSeconds: since ? Number(since) : undefined, previous }),
    [cluster, namespace, podsKey, container, tail, since, previous]
  );

  const load = useCallback(async () => {
    if (!namespace) return;
    setLoading(true);
    setError(null);
    setWarnings([]);
    try {
      if (source === 'history') {
        const r = await observabilityApi.logHistory({ ...request, search: search.trim() || undefined, sinceSeconds: request.sinceSeconds || 3600, limit: 2000 });
        setLines(r.lines);
        setHistoryQuery(r.query);
      } else {
        const r = await observabilityApi.logs(request);
        setLines(r.lines);
        setWarnings([
          ...r.errors.map((e) => `${e.target}: ${e.message}`),
          ...(r.truncated ? ['Showing the first 20 containers only. Pick a workload or pod to narrow it down.'] : []),
        ]);
      }
      setUnseen(0);
    } catch (err) {
      setLines([]);
      setError(getApiErrorMessage(err, 'Could not load logs'));
    } finally {
      setLoading(false);
    }
    // search only matters for Loki queries; live search filters locally
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, source]);

  useEffect(() => {
    load();
  }, [load]);

  // Live follow: stream new lines after the initial load.
  useEffect(() => {
    stopRef.current?.();
    stopRef.current = null;
    if (!follow || source !== 'live' || previous || !namespace) {
      setStreamState('off');
      return;
    }
    setStreamState('connecting');
    stopRef.current = observabilityApi.streamLogs(
      request,
      (e) => {
        if (e.type === 'line') {
          setLines((prev) => {
            const next = prev.length >= MAX_LINES ? prev.slice(prev.length - MAX_LINES + 1) : prev.slice();
            next.push({ ts: e.ts, pod: e.pod, container: e.container, text: e.text });
            return next;
          });
          if (!atBottomRef.current) setUnseen((n) => n + 1);
        } else if (e.type === 'status' && e.status === 'connected') setStreamState('live');
      },
      (err) => {
        setStreamState('ended');
        if (err) setError(err);
      }
    );
    return () => {
      stopRef.current?.();
      stopRef.current = null;
    };
  }, [follow, source, previous, namespace, request]);

  const pattern = useMemo(() => {
    const q = search.trim();
    if (!q) return null;
    try {
      return new RegExp(`(${useRegex ? q : escapeRegex(q)})`, 'gi');
    } catch {
      return null;
    }
  }, [search, useRegex]);

  const visible = useMemo(() => {
    return lines.filter((l) => {
      if (level !== 'all') {
        const lv = logLevel(l.text);
        if (level === 'error' && lv !== 'error') return false;
        if (level === 'warn' && lv !== 'error' && lv !== 'warn') return false;
      }
      if (pattern && onlyMatches) {
        pattern.lastIndex = 0;
        return pattern.test(l.text) || pattern.test(l.pod);
      }
      return true;
    });
  }, [lines, level, pattern, onlyMatches]);

  const errorCount = useMemo(() => lines.filter((l) => logLevel(l.text) === 'error').length, [lines]);
  const multiPod = useMemo(() => new Set(lines.map((l) => l.pod)).size > 1, [lines]);
  const multiContainer = useMemo(() => new Set(lines.map((l) => l.container)).size > 1, [lines]);

  // Stick to the bottom while the user is at the bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [visible]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    atBottomRef.current = bottom;
    setAtBottom(bottom);
    if (bottom) setUnseen(0);
  };

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    atBottomRef.current = true;
    setAtBottom(true);
    setUnseen(0);
  };

  const asText = () => visible.map((l) => `${l.ts} ${multiPod ? `[${l.pod}/${l.container}] ` : ''}${l.text}`).join('\n');
  const download = () => {
    const blob = new Blob([asText()], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${namespace}-${pods.length === 1 ? pods[0] : 'pods'}-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const hasPrevious = previous;
  const toggle = (active: boolean) =>
    `inline-flex items-center gap-1 h-8 px-2.5 rounded-md border text-xs font-medium transition-colors ${
      active ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
    }`;

  return (
    <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
      {/* controls */}
      <div className="flex flex-wrap items-center gap-2 p-2 border-b border-slate-200 bg-slate-50">
        {lokiAvailable && (
          <div className="inline-flex rounded-md border border-slate-200 overflow-hidden" role="group" aria-label="Log source">
            <button type="button" onClick={() => setSource('live')} className={`h-8 px-2.5 text-xs font-medium ${source === 'live' ? 'bg-slate-900 text-white' : 'bg-white text-slate-700'}`}>
              Live pods
            </button>
            <button
              type="button"
              onClick={() => {
                setSource('history');
                setFollow(false);
              }}
              className={`h-8 px-2.5 text-xs font-medium inline-flex items-center gap-1 ${source === 'history' ? 'bg-slate-900 text-white' : 'bg-white text-slate-700'}`}
            >
              <History size={12} /> History (Loki)
            </button>
          </div>
        )}
        {source === 'live' && !since && <Dropdown size="sm" ariaLabel="Lines" value={tail} onChange={setTail} options={TAIL_OPTIONS} />}
        <Dropdown
          size="sm"
          ariaLabel="Time range"
          value={since}
          onChange={setSince}
          options={source === 'history' ? SINCE_OPTIONS.filter((o) => o.value) : SINCE_OPTIONS}
          placeholder="Last hour"
        />
        {source === 'live' && (
          <>
            <button
              type="button"
              className={toggle(follow)}
              onClick={() => {
                setFollow((f) => !f);
                if (!follow) setPrevious(false);
              }}
              title="Stream new lines as they are written"
            >
              {follow ? <Pause size={12} /> : <Play size={12} />}
              {follow ? (streamState === 'live' ? 'Following' : 'Connecting…') : 'Follow'}
              {follow && streamState === 'live' && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" aria-hidden />}
            </button>
            <button
              type="button"
              className={toggle(hasPrevious)}
              onClick={() => {
                setPrevious((p) => !p);
                setFollow(false);
              }}
              title="Logs of the previous (crashed or restarted) container"
            >
              <History size={12} /> Previous run
            </button>
          </>
        )}
        <Dropdown size="sm" ariaLabel="Level" value={level} onChange={(v) => setLevel(v as LevelFilter)} options={LEVEL_OPTIONS} />

        <div className="relative flex-1 min-w-[180px]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && source === 'history' && load()}
            placeholder={source === 'history' ? 'Search text (Enter to query Loki)' : 'Search in logs (text, or regex with .*)'}
            aria-label="Search logs"
            className="w-full h-8 pl-7 pr-16 rounded-md border border-slate-200 bg-white text-xs font-mono focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500"
          />
          <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => setUseRegex((r) => !r)}
              className={`px-1.5 h-6 rounded text-[10px] font-mono ${useRegex ? 'bg-sky-100 text-sky-800' : 'text-slate-400 hover:text-slate-700'}`}
              title="Regular expression"
            >
              .*
            </button>
            {search && (
              <button type="button" onClick={() => setSearch('')} className="p-1 text-slate-400 hover:text-slate-700" aria-label="Clear search">
                <X size={12} />
              </button>
            )}
          </div>
        </div>
        {search && (
          <button type="button" className={toggle(onlyMatches)} onClick={() => setOnlyMatches((o) => !o)} title="Hide lines that do not match">
            Only matches
          </button>
        )}

        <div className="flex items-center gap-1 ml-auto">
          <button type="button" className={toggle(showTime)} onClick={() => setShowTime((t) => !t)} title="Show timestamps" aria-label="Timestamps">
            <Clock size={12} />
          </button>
          <button type="button" className={toggle(wrap)} onClick={() => setWrap((w) => !w)} title="Wrap long lines" aria-label="Wrap lines">
            <WrapText size={12} />
          </button>
          <Button size="sm" variant="secondary" onClick={load} disabled={loading} aria-label="Reload" className="h-8">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </Button>
          <Button size="sm" variant="secondary" onClick={() => navigator.clipboard?.writeText(asText())} aria-label="Copy logs" className="h-8" disabled={!visible.length}>
            <Copy size={12} />
          </Button>
          <Button size="sm" variant="secondary" onClick={download} aria-label="Download logs" className="h-8" disabled={!visible.length}>
            <Download size={12} />
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setLines([])} aria-label="Clear" className="h-8" disabled={!lines.length}>
            <Trash2 size={12} />
          </Button>
        </div>
      </div>

      {/* status */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 text-[11px] text-slate-500 border-b border-slate-200">
        <span>
          <strong className="text-slate-700">{visible.length.toLocaleString()}</strong>
          {visible.length !== lines.length && ` of ${lines.length.toLocaleString()}`} lines
        </span>
        {errorCount > 0 && (
          <button type="button" onClick={() => setLevel('error')} className="text-rose-700 font-semibold hover:underline">
            {errorCount} error{errorCount === 1 ? '' : 's'}
          </button>
        )}
        {previous && <span className="text-amber-700 font-semibold">previous container run</span>}
        {source === 'history' && historyQuery && <span className="font-mono truncate max-w-md" title={historyQuery}>LogQL: {historyQuery}</span>}
        {lines.length >= MAX_LINES && <span>buffer full, oldest lines dropped</span>}
      </div>

      {(error || warnings.length > 0) && (
        <div className="px-3 py-2 text-xs border-b border-slate-200 space-y-1">
          {error && (
            <div className="flex items-start gap-1.5 text-rose-700">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" />
              <span>
                {error}
                {previous && /previous terminated container/i.test(error) && ' This container has not restarted, so there is no previous run.'}
              </span>
            </div>
          )}
          {warnings.map((w) => (
            <div key={w} className="flex items-start gap-1.5 text-amber-800">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" /> {w}
            </div>
          ))}
        </div>
      )}

      {/* lines */}
      <div className="relative">
        <div ref={scrollRef} onScroll={onScroll} className={`${height} overflow-auto bg-slate-950 font-mono text-[12px] leading-[1.55] py-2`} role="log" aria-live="off">
          {loading && !lines.length ? (
            <div className="px-3 text-slate-400">Loading logs…</div>
          ) : !visible.length ? (
            <div className="px-3 text-slate-500">
              {lines.length ? 'No lines match the filters.' : namespace ? 'No log lines for this selection.' : 'Pick a namespace.'}
            </div>
          ) : (
            visible.map((l, i) => {
              const lv = logLevel(l.text);
              return (
                <div
                  key={`${l.ts}-${l.pod}-${i}`}
                  className={`flex gap-2 px-3 hover:bg-white/5 ${lv === 'error' ? 'bg-rose-500/10' : lv === 'warn' ? 'bg-amber-400/5' : ''}`}
                >
                  {showTime && <span className="text-slate-500 shrink-0 select-none">{l.ts ? l.ts.slice(11, 23) : ''}</span>}
                  {(multiPod || multiContainer) && (
                    <span className={`${podColor(l.pod)} shrink-0 select-none`} title={`${l.pod} / ${l.container}`}>
                      [{shortPod(l.pod)}
                      {multiContainer ? `/${l.container}` : ''}]
                    </span>
                  )}
                  <span className={`${LEVEL_CLASS[lv]} ${wrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'} min-w-0`}>
                    <Highlight text={l.text} pattern={pattern} />
                  </span>
                </div>
              );
            })
          )}
        </div>
        {!atBottom && (
          <button
            type="button"
            onClick={scrollToBottom}
            className="absolute bottom-3 right-5 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-sky-600 text-white text-[11px] font-semibold shadow-lg hover:bg-sky-500"
          >
            <ArrowDownToLine size={12} />
            {unseen ? `${unseen} new line${unseen === 1 ? '' : 's'}` : 'Latest'}
          </button>
        )}
      </div>
    </div>
  );
};
