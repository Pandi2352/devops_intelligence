import { DnsRecordType } from '../../api/dnsApi';

export const selectClass =
  'w-full px-3 py-2 rounded-md bg-white border border-slate-300 text-slate-900 text-sm transition-colors focus:outline-none focus:ring-2 focus:border-sky-500 focus:ring-sky-100 disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed';

export const PROXIABLE_TYPES = ['A', 'AAAA', 'CNAME'];

/** "www.example.com" in zone "example.com" → "www"; the apex → "@". */
export const relativeName = (name: string, zone: string) => {
  if (name === zone) return '@';
  return name.endsWith(`.${zone}`) ? name.slice(0, -zone.length - 1) : name;
};

/** What Cloudflare will store for a name typed in the form. */
export const fullName = (input: string, zone: string) => {
  const n = input.trim().replace(/\.$/, '').toLowerCase();
  if (!n || n === '@') return zone;
  if (n === zone || n.endsWith(`.${zone}`)) return n;
  return `${n}.${zone}`;
};

export const ttlLabel = (ttl: number) => {
  if (ttl === 1) return 'Auto';
  if (ttl % 86400 === 0) return `${ttl / 86400} d`;
  if (ttl % 3600 === 0) return `${ttl / 3600} h`;
  if (ttl % 60 === 0) return `${ttl / 60} min`;
  return `${ttl} s`;
};

export const TTL_OPTIONS = [1, 60, 300, 3600, 86400].map((v) => ({ value: v, label: v === 1 ? 'Auto' : ttlLabel(v) }));

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const HOSTNAME = /^(?=.{1,253}\.?$)([a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?\.)+[a-z][a-z0-9-]{0,62}\.?$/i;
const RECORD_NAME = /^(@|\*|(\*\.)?[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?(\.[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?)*)\.?$/i;

const isIpv6 = (v: string) => {
  if (!/^[0-9a-f:.]+$/i.test(v) || !v.includes(':')) return false;
  const doubles = v.split('::').length - 1;
  if (doubles > 1) return false;
  const groups = v.split(':').filter(Boolean);
  if (groups.some((g) => g.length > 4 && !IPV4.test(g))) return false;
  return doubles === 1 ? groups.length < 8 : groups.length === 8;
};

export const validateRecordName = (name: string) => {
  const n = name.trim();
  if (!n) return 'Enter a name, or @ for the zone root';
  if (n.length > 253 || !RECORD_NAME.test(n)) return 'Use letters, digits, hyphens and dots only';
  return '';
};

export const validateRecordContent = (type: DnsRecordType, content: string) => {
  const v = content.trim();
  if (!v) return 'Content is required';
  switch (type) {
    case 'A':
      return IPV4.test(v) ? '' : 'Enter an IPv4 address, e.g. 203.0.113.10';
    case 'AAAA':
      return isIpv6(v) ? '' : 'Enter an IPv6 address, e.g. 2001:db8::1';
    case 'CNAME':
    case 'MX':
      return HOSTNAME.test(v) ? '' : 'Enter a hostname, e.g. target.example.com';
    case 'TXT':
      return content.length > 2048 ? 'TXT content is limited to 2048 characters' : '';
    default:
      return '';
  }
};

export const CONTENT_PLACEHOLDER: Record<DnsRecordType, string> = {
  A: '203.0.113.10',
  AAAA: '2001:db8::1',
  CNAME: 'target.example.com',
  TXT: 'v=spf1 include:_spf.example.com ~all',
  MX: 'mail.example.com',
};

export const CONTENT_LABEL: Record<DnsRecordType, string> = {
  A: 'IPv4 address',
  AAAA: 'IPv6 address',
  CNAME: 'Target hostname',
  TXT: 'Text',
  MX: 'Mail server',
};

export const typeChipClass = (type: string) => {
  switch (type) {
    case 'A':
    case 'AAAA':
      return 'bg-sky-50 text-sky-800 border-sky-200';
    case 'CNAME':
      return 'bg-indigo-50 text-indigo-800 border-indigo-200';
    case 'TXT':
      return 'bg-slate-100 text-slate-700 border-slate-200';
    case 'MX':
      return 'bg-purple-50 text-purple-800 border-purple-200';
    default:
      return 'bg-slate-50 text-slate-600 border-slate-200';
  }
};

export const tunnelStatusClass = (status: string) => {
  switch (status) {
    case 'healthy':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'degraded':
      return 'bg-amber-50 text-amber-800 border-amber-200';
    case 'down':
      return 'bg-rose-50 text-rose-700 border-rose-200';
    default:
      return 'bg-slate-100 text-slate-700 border-slate-200';
  }
};

export const TUNNEL_NAME = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

/** di-<cluster> turned into a valid lowercase DNS label. */
export const defaultTunnelName = (cluster: string) =>
  `di-${cluster}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 63)
    .replace(/-$/, '');
