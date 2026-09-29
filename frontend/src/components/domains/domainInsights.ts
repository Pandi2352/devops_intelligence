import type { HostInspection, TokenCapabilities, ZoneOverview } from '../../api/dnsApi';

export type InsightLevel = 'bad' | 'warn' | 'info' | 'good';
export interface Insight {
  level: InsightLevel;
  title: string;
  detail: string;
}

// Cloudflare 52x errors: Cloudflare answered, the origin behind it did not.
const CF_ERRORS: Record<number, string> = {
  520: 'the origin returned an empty or unexpected answer',
  521: 'the origin refused the connection (server down or firewall blocks Cloudflare)',
  522: 'the origin did not answer in time (server down, wrong IP in DNS, or firewall blocks Cloudflare)',
  523: 'the origin is unreachable (wrong IP / no route)',
  524: 'the origin took longer than 100 s to respond',
  525: 'the TLS handshake with the origin failed (SSL mode vs origin certificate)',
  526: 'the origin certificate is invalid (SSL mode Full (strict))',
  530: 'the origin could not be resolved (often a deleted tunnel or wrong CNAME)',
};

export const httpLabel = (h: HostInspection['https']) => {
  if (!h.ok) return h.error || 'Not reachable';
  if (h.status >= 300 && h.status < 400) return `HTTP ${h.status} → ${h.location || 'redirect'}`;
  if (CF_ERRORS[h.status]) return `HTTP ${h.status} (Cloudflare error)`;
  return `HTTP ${h.status}`;
};

export const hostTone = (h: HostInspection): 'good' | 'warn' | 'bad' => {
  if (!h.https.ok || h.https.status >= 500) return 'bad';
  if (h.https.status >= 400 || (h.tls.daysLeft !== null && h.tls.daysLeft < 14) || (h.tls.ok && !h.tls.valid)) return 'warn';
  return 'good';
};

export const hostInsights = (h: HostInspection): Insight[] => {
  const out: Insight[] = [];
  const s = h.https.status;
  if (CF_ERRORS[s]) out.push({ level: 'bad', title: `${h.hostname} returns ${s}`, detail: `Cloudflare is up, but ${CF_ERRORS[s]}. Check the DNS record for ${h.hostname} and that the server behind it is running.` });
  else if (!h.https.ok) out.push({ level: 'bad', title: `${h.hostname} is not reachable`, detail: h.https.error });
  else if (s >= 500) out.push({ level: 'bad', title: `${h.hostname} returns ${s}`, detail: 'The site answers with a server error.' });
  else if (s === 404) out.push({ level: 'warn', title: `${h.hostname} returns 404`, detail: 'The host answers but has no page at /. Fine for an API; for a website check the deployment.' });
  if (h.tls.ok && !h.tls.valid) out.push({ level: 'bad', title: `Certificate problem on ${h.hostname}`, detail: h.tls.error || 'The certificate is not trusted.' });
  if (h.tls.daysLeft !== null && h.tls.daysLeft < 14) out.push({ level: 'warn', title: `Certificate of ${h.hostname} expires in ${h.tls.daysLeft} days`, detail: h.https.viaCloudflare ? 'Cloudflare renews edge certificates automatically; check the zone SSL/TLS page if this persists.' : 'Renew it before it expires.' });
  if (!h.dns.A.length && !h.dns.AAAA.length && !h.dns.CNAME.length && !h.dns.error) out.push({ level: 'warn', title: `${h.hostname} does not resolve`, detail: 'There is no DNS record for it.' });
  return out;
};

export const settingValue = (o: ZoneOverview, id: string) => o.settings?.find((x) => x.id === id)?.value;

export const zoneInsights = (o: ZoneOverview): Insight[] => {
  const out: Insight[] = [];
  if (o.zone.status === 'pending') out.push({ level: 'bad', title: 'Zone not active yet', detail: `Set the name servers at your registrar to ${o.zone.nameServers.join(' and ')}.` });
  if (o.zone.paused) out.push({ level: 'warn', title: 'Cloudflare is paused for this zone', detail: 'Traffic goes straight to the origin: no proxy, cache or protection.' });
  if (o.zone.developmentMode && o.zone.developmentMode > 0) out.push({ level: 'info', title: 'Development mode is on', detail: 'Caching is bypassed until it switches itself off.' });
  for (const h of o.public) out.push(...hostInsights(h));
  if (o.settings) {
    if (settingValue(o, 'always_use_https') === 'off') out.push({ level: 'warn', title: 'Always Use HTTPS is off', detail: 'Visitors can still open the site over plain http://. Turn it on in SSL/TLS → Edge Certificates.' });
    const minTls = settingValue(o, 'min_tls_version');
    if (minTls && Number(minTls) < 1.2) out.push({ level: 'warn', title: `Minimum TLS version is ${minTls}`, detail: 'TLS 1.0/1.1 are obsolete. 1.2 is the safe minimum (SSL/TLS → Edge Certificates).' });
    const ssl = settingValue(o, 'ssl');
    if (ssl === 'flexible') out.push({ level: 'warn', title: 'SSL mode is Flexible', detail: 'Cloudflare talks to your origin over plain HTTP. Use Full (strict) when the origin has a certificate.' });
    if (ssl === 'off') out.push({ level: 'bad', title: 'SSL is off', detail: 'The site is served without HTTPS.' });
  }
  if (!out.some((i) => i.level === 'bad' || i.level === 'warn')) out.push({ level: 'good', title: 'No problems found', detail: 'Name servers, HTTPS and certificates look fine.' });
  return out;
};

// Permissions the token is missing, as Cloudflare names them.
export const missingPermissions = (c: TokenCapabilities | null) => {
  if (!c) return [];
  const out: string[] = [];
  if (!c.dnsRead) out.push('Zone → DNS → Read (Edit to apply hostnames)');
  if (!c.settingsRead) out.push('Zone → Zone Settings → Read');
  if (c.tunnelRead === false) out.push('Account → Cloudflare Tunnel → Read (Edit to create tunnels)');
  return out;
};

export const SETTING_LABELS: Record<string, string> = {
  ssl: 'SSL/TLS mode',
  always_use_https: 'Always use HTTPS',
  min_tls_version: 'Minimum TLS version',
  tls_1_3: 'TLS 1.3',
  automatic_https_rewrites: 'Automatic HTTPS rewrites',
  http3: 'HTTP/3 (QUIC)',
  brotli: 'Brotli compression',
  security_level: 'Security level',
  cache_level: 'Cache level',
  browser_cache_ttl: 'Browser cache TTL (s)',
  development_mode: 'Development mode',
  ipv6: 'IPv6',
  websockets: 'WebSockets',
};

export const INSIGHT_STYLE: Record<InsightLevel, string> = {
  bad: 'border-rose-200 bg-rose-50 text-rose-900',
  warn: 'border-amber-200 bg-amber-50 text-amber-900',
  info: 'border-sky-200 bg-sky-50 text-sky-900',
  good: 'border-emerald-200 bg-emerald-50 text-emerald-900',
};
