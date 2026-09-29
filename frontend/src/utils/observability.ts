import type { MetricUnit } from '../api/observabilityApi';

export const formatCores = (cores?: number): string => {
  if (cores === undefined || Number.isNaN(cores)) return '—';
  if (cores >= 1) return `${cores.toFixed(2)} cores`;
  const m = cores * 1000;
  return `${m < 10 ? m.toFixed(1) : Math.round(m)}m`;
};

export const formatBytes = (bytes?: number): string => {
  if (bytes === undefined || Number.isNaN(bytes)) return '—';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
};

export const formatMetric = (value: number, unit: MetricUnit): string => {
  if (unit === 'cores') return formatCores(value);
  if (unit === 'bytes') return formatBytes(value);
  if (unit === 'Bps') return `${formatBytes(value)}/s`;
  if (unit === 'percent') return `${value.toFixed(value < 10 ? 1 : 0)}%`;
  if (unit === 'rps') return `${value < 10 ? value.toFixed(2) : Math.round(value)} req/s`;
  if (unit === 'seconds') return value < 1 ? `${Math.round(value * 1000)} ms` : `${value.toFixed(2)} s`;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
};

// "250m" / "0.5" / "1" -> cores; "128Mi" -> bytes (for requests/limits shown next to usage)
export const parseCpuQuantity = (v?: string): number | undefined => {
  if (!v) return undefined;
  return v.endsWith('m') ? parseFloat(v) / 1000 : parseFloat(v);
};

export const parseMemoryQuantity = (v?: string): number | undefined => {
  if (!v) return undefined;
  const m = /^([0-9.]+)([a-zA-Z]*)$/.exec(v);
  if (!m) return undefined;
  const mult: Record<string, number> = { '': 1, k: 1e3, M: 1e6, G: 1e9, Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3 };
  return parseFloat(m[1]) * (mult[m[2]] ?? 1);
};

export type Tone = 'ok' | 'warn' | 'bad' | 'muted';

export const podTone = (status: string, ready = true): Tone => {
  if (/CrashLoop|Err|BackOff|OOM|Failed|Error|Evicted|Unknown/i.test(status)) return 'bad';
  if (/Completed|Succeeded/i.test(status)) return 'muted';
  if (/Pending|Creating|Init|Terminating|ContainerCreating/i.test(status) || !ready) return 'warn';
  return 'ok';
};

export const TONE_CLASS: Record<Tone, string> = {
  ok: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  warn: 'bg-amber-50 text-amber-800 border-amber-200',
  bad: 'bg-rose-50 text-rose-700 border-rose-200',
  muted: 'bg-slate-100 text-slate-600 border-slate-200',
};

export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | '';

// Detects the level of a plain or JSON log line.
export const logLevel = (text: string): LogLevel => {
  const json = /"(level|severity|lvl)"\s*:\s*"?([a-zA-Z]+)/.exec(text);
  const raw = (json?.[2] || /\b(FATAL|PANIC|ERROR|ERR|WARN|WARNING|INFO|DEBUG|TRACE)\b/i.exec(text)?.[1] || '').toLowerCase();
  if (['error', 'err', 'fatal', 'panic', 'crit', 'critical'].includes(raw)) return 'error';
  if (['warn', 'warning'].includes(raw)) return 'warn';
  if (raw === 'info') return 'info';
  if (['debug', 'trace'].includes(raw)) return 'debug';
  return '';
};

// Stable colour per pod so interleaved lines from several pods are easy to follow.
const POD_COLORS = ['text-sky-300', 'text-violet-300', 'text-amber-300', 'text-emerald-300', 'text-pink-300', 'text-cyan-300', 'text-lime-300', 'text-orange-300'];
export const podColor = (pod: string): string => {
  let h = 0;
  for (let i = 0; i < pod.length; i += 1) h = (h * 31 + pod.charCodeAt(i)) >>> 0;
  return POD_COLORS[h % POD_COLORS.length];
};

// demo-api-f7bcdcf95-qw9p2 -> qw9p2 (the part that differs between replicas)
export const shortPod = (pod: string): string => {
  const parts = pod.split('-');
  return parts.length > 2 ? parts[parts.length - 1] : pod;
};

export const TIME_RANGES = [
  { value: '15m', label: 'Last 15 minutes' },
  { value: '1h', label: 'Last hour' },
  { value: '6h', label: 'Last 6 hours' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
];

export const SINCE_OPTIONS = [
  { value: '', label: 'Tail' },
  { value: '300', label: 'Last 5 min' },
  { value: '900', label: 'Last 15 min' },
  { value: '3600', label: 'Last hour' },
  { value: '21600', label: 'Last 6 hours' },
  { value: '86400', label: 'Last 24 hours' },
];
