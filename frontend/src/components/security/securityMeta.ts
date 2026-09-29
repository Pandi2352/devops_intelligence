import { ReleaseCheck, Severity, SeverityCounts } from '../../api/securityApi';

export const SEVERITIES: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];

export const SEVERITY_META: Record<Severity, { label: string; key: keyof SeverityCounts; chip: string; rank: number }> = {
  CRITICAL: { label: 'Critical', key: 'critical', chip: 'bg-rose-50 border-rose-200 text-rose-800', rank: 0 },
  HIGH: { label: 'High', key: 'high', chip: 'bg-orange-50 border-orange-200 text-orange-800', rank: 1 },
  MEDIUM: { label: 'Medium', key: 'medium', chip: 'bg-amber-50 border-amber-200 text-amber-900', rank: 2 },
  LOW: { label: 'Low', key: 'low', chip: 'bg-slate-100 border-slate-300 text-slate-700', rank: 3 },
  UNKNOWN: { label: 'Unknown', key: 'unknown', chip: 'bg-gray-50 border-gray-200 text-gray-500', rank: 4 },
};

export const severityMeta = (s: string) => SEVERITY_META[(s || '').toUpperCase() as Severity] || SEVERITY_META.UNKNOWN;

export const totalCount = (c?: SeverityCounts | null) => (c ? c.critical + c.high + c.medium + c.low + c.unknown : 0);

// SonarQube returns ratings as "1.0".."5.0"; the backend maps them to A–E, but accept both.
export const ratingLetter = (v?: string): string => {
  if (!v) return '';
  if (/^[A-E]$/i.test(v)) return v.toUpperCase();
  const n = Math.round(Number(v));
  return n >= 1 && n <= 5 ? 'ABCDE'[n - 1] : '';
};

export const RATING_CHIP: Record<string, string> = {
  A: 'bg-emerald-600 text-white',
  B: 'bg-lime-500 text-white',
  C: 'bg-amber-400 text-slate-900',
  D: 'bg-orange-500 text-white',
  E: 'bg-rose-600 text-white',
};

export const RATINGS: { key: string; label: string }[] = [
  { key: 'reliability_rating', label: 'Reliability' },
  { key: 'security_rating', label: 'Security' },
  { key: 'sqale_rating', label: 'Maintainability' },
  { key: 'security_review_rating', label: 'Security review' },
];

export const MEASURES: { key: string; label: string; suffix?: string }[] = [
  { key: 'bugs', label: 'Bugs' },
  { key: 'vulnerabilities', label: 'Vulnerabilities' },
  { key: 'security_hotspots', label: 'Security hotspots' },
  { key: 'code_smells', label: 'Code smells' },
  { key: 'coverage', label: 'Coverage', suffix: '%' },
  { key: 'duplicated_lines_density', label: 'Duplications', suffix: '%' },
  { key: 'ncloc', label: 'Lines of code' },
];

export const formatMeasure = (value: string | undefined, suffix?: string): string => {
  if (value === undefined || value === null || value === '') return '—';
  const n = Number(value);
  if (Number.isNaN(n)) return value;
  const text = suffix === '%' ? (Math.round(n * 10) / 10).toString() : n.toLocaleString();
  return `${text}${suffix || ''}`;
};

// Human names for SonarQube quality gate metrics.
const METRIC_LABEL: Record<string, string> = {
  new_coverage: 'Coverage on new code',
  coverage: 'Coverage',
  new_duplicated_lines_density: 'Duplications on new code',
  duplicated_lines_density: 'Duplications',
  new_reliability_rating: 'Reliability on new code',
  new_security_rating: 'Security on new code',
  new_maintainability_rating: 'Maintainability on new code',
  new_security_hotspots_reviewed: 'Hotspots reviewed on new code',
  new_violations: 'New issues',
  reliability_rating: 'Reliability',
  security_rating: 'Security',
  sqale_rating: 'Maintainability',
};

export const metricLabel = (metric: string) => METRIC_LABEL[metric] || metric.replace(/_/g, ' ');

export const GATE_META: Record<string, { label: string; chip: string }> = {
  OK: { label: 'Passed', chip: 'bg-emerald-50 border-emerald-200 text-emerald-800' },
  ERROR: { label: 'Failed', chip: 'bg-rose-50 border-rose-200 text-rose-800' },
  WARN: { label: 'Warning', chip: 'bg-amber-50 border-amber-200 text-amber-900' },
  NONE: { label: 'No quality gate', chip: 'bg-slate-50 border-slate-200 text-slate-600' },
};

export const CHECK_META: Record<ReleaseCheck['status'], { symbol: string; text: string; box: string; icon: string }> = {
  pass: { symbol: '✓', text: 'text-emerald-800', box: 'bg-emerald-50 border-emerald-200', icon: 'bg-emerald-600 text-white' },
  fail: { symbol: '✗', text: 'text-rose-800', box: 'bg-rose-50 border-rose-200', icon: 'bg-rose-600 text-white' },
  warn: { symbol: '!', text: 'text-amber-900', box: 'bg-amber-50 border-amber-200', icon: 'bg-amber-500 text-white' },
  unknown: { symbol: '?', text: 'text-slate-700', box: 'bg-slate-50 border-slate-200', icon: 'bg-slate-400 text-white' },
};

export const checkMeta = (status: string) => CHECK_META[status as ReleaseCheck['status']] || CHECK_META.unknown;

export const isReleaseCheckList = (v: unknown): v is ReleaseCheck[] =>
  Array.isArray(v) && v.every((c) => c && typeof c === 'object' && 'label' in c && 'status' in c);

export const ANALYSIS_STATE_META: Record<string, { label: string; chip: string }> = {
  running: { label: 'Running', chip: 'bg-sky-50 border-sky-200 text-sky-800' },
  succeeded: { label: 'Succeeded', chip: 'bg-emerald-50 border-emerald-200 text-emerald-800' },
  failed: { label: 'Failed', chip: 'bg-rose-50 border-rose-200 text-rose-800' },
  gone: { label: 'Job removed', chip: 'bg-slate-50 border-slate-200 text-slate-600' },
  unknown: { label: 'Unknown', chip: 'bg-slate-50 border-slate-200 text-slate-600' },
};

/** Compact label for environment badges, e.g. "3 critical · 12 high". */
export const vulnSummary = (c: SeverityCounts) => {
  if (!c.critical && !c.high) return { label: 'No critical/high CVEs', chip: 'bg-emerald-50 border-emerald-200 text-emerald-800' };
  const parts = [c.critical ? `${c.critical} critical` : '', c.high ? `${c.high} high` : ''].filter(Boolean);
  return {
    label: parts.join(' · '),
    chip: c.critical ? 'bg-rose-50 border-rose-200 text-rose-800' : 'bg-orange-50 border-orange-200 text-orange-800',
  };
};
