import React from 'react';
import { Cloud, ExternalLink, Lock, Network } from 'lucide-react';
import type { HostInspection } from '../../api/dnsApi';
import { hostTone, httpLabel } from './domainInsights';
import { formatDateTime } from '../../utils/format';

const TONE = {
  good: 'border-emerald-200',
  warn: 'border-amber-300',
  bad: 'border-rose-300',
};
const DOT = { good: 'bg-emerald-500', warn: 'bg-amber-500', bad: 'bg-rose-500' };

// What the internet sees for one hostname: DNS answers, HTTPS status and the certificate.
export const HostCheck: React.FC<{ host: HostInspection; compact?: boolean }> = ({ host, compact }) => {
  const tone = hostTone(host);
  const addresses = [...host.dns.CNAME.map((c) => `CNAME ${c}`), ...host.dns.A, ...host.dns.AAAA];
  return (
    <div className={`rounded-md border bg-white p-3 space-y-2 ${TONE[tone]}`}>
      <div className="flex items-center justify-between gap-2">
        <a href={`https://${host.hostname}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-mono text-[12px] font-semibold text-slate-900 hover:text-sky-700 hover:underline min-w-0">
          <span className={`w-2 h-2 rounded-full shrink-0 ${DOT[tone]}`} aria-hidden />
          <span className="truncate">{host.hostname}</span>
          <ExternalLink size={11} className="shrink-0 text-slate-400" />
        </a>
        <span className={`text-[11px] font-mono font-semibold ${tone === 'good' ? 'text-emerald-700' : tone === 'warn' ? 'text-amber-700' : 'text-rose-700'}`}>
          {httpLabel(host.https)}
          {host.https.ok && <span className="text-slate-400 font-normal"> · {host.https.ms} ms</span>}
        </span>
      </div>
      <dl className={`grid ${compact ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-3'} gap-x-4 gap-y-1.5 text-[11px]`}>
        <div className="min-w-0">
          <dt className="flex items-center gap-1 text-slate-500">
            <Network size={11} aria-hidden /> Resolves to
          </dt>
          <dd className="font-mono text-slate-700 break-all" title={addresses.join('\n')}>
            {host.dns.error ? <span className="text-rose-700">{host.dns.error}</span> : addresses.length ? addresses.slice(0, compact ? 2 : 4).join(', ') + (addresses.length > (compact ? 2 : 4) ? ' …' : '') : 'nothing'}
          </dd>
        </div>
        <div>
          <dt className="flex items-center gap-1 text-slate-500">
            <Cloud size={11} aria-hidden /> Served by
          </dt>
          <dd className="text-slate-700">
            {host.https.viaCloudflare ? <span className="text-orange-600 font-semibold">Cloudflare proxy</span> : host.https.server || '—'}
            {host.https.poweredBy && <span className="text-slate-500"> · {host.https.poweredBy}</span>}
          </dd>
        </div>
        <div>
          <dt className="flex items-center gap-1 text-slate-500">
            <Lock size={11} aria-hidden /> Certificate
          </dt>
          <dd className="text-slate-700" title={host.tls.validTo ? `Valid until ${formatDateTime(host.tls.validTo)}\n${host.tls.altNames.join(', ')}` : undefined}>
            {host.tls.ok ? (
              <>
                <span className={host.tls.valid ? '' : 'text-rose-700 font-semibold'}>{host.tls.valid ? host.tls.issuer || 'valid' : 'not trusted'}</span>
                {host.tls.daysLeft !== null && <span className={host.tls.daysLeft < 14 ? 'text-amber-700 font-semibold' : 'text-slate-500'}> · {host.tls.daysLeft} days left</span>}
              </>
            ) : (
              <span className="text-rose-700">{host.tls.error || 'none'}</span>
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
};
