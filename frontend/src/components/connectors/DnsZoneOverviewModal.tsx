import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, CheckCircle2, ExternalLink, Info, KeyRound, ListTree, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { Modal } from '../common/Modal';
import { ConnectorLogoTile } from './ConnectorLogos';
import { HostCheck } from '../domains/HostCheck';
import { INSIGHT_STYLE, InsightLevel, missingPermissions, SETTING_LABELS, zoneInsights } from '../domains/domainInsights';
import { dnsApi, DnsConnector, DnsZone, ZoneOverview } from '../../api/dnsApi';
import { getApiErrorMessage } from '../../api/client';
import { formatDateTime, formatRelativeTime } from '../../utils/format';

const LEVEL_ICON: Record<InsightLevel, React.ReactNode> = {
  bad: <XCircle size={14} className="shrink-0 mt-0.5" />,
  warn: <AlertTriangle size={14} className="shrink-0 mt-0.5" />,
  info: <Info size={14} className="shrink-0 mt-0.5" />,
  good: <CheckCircle2 size={14} className="shrink-0 mt-0.5" />,
};

const Section: React.FC<{ title: string; children: React.ReactNode; aside?: React.ReactNode }> = ({ title, children, aside }) => (
  <section className="space-y-2">
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{title}</h3>
      {aside}
    </div>
    {children}
  </section>
);

const Denied: React.FC<{ message: string }> = ({ message }) => (
  <div className="p-2.5 rounded-md border border-dashed border-slate-300 bg-slate-50 text-[11px] text-slate-600 flex items-center gap-2">
    <KeyRound size={13} className="text-slate-400 shrink-0" /> {message}. Add it to the API token in Cloudflare, then press Test on the connector.
  </div>
);

interface Props {
  connector: Pick<DnsConnector, '_id' | 'name' | 'capabilities'>;
  zone: DnsZone;
  onBack?: () => void;
  onRecords?: () => void;
  onClose: () => void;
}

// Everything DevOps Intelligence can see about one domain: Cloudflare details (as far as the token allows)
// plus what the internet sees for the domain and www (needs no permission).
export const DnsZoneOverviewModal: React.FC<Props> = ({ connector, zone, onBack, onRecords, onClose }) => {
  const [data, setData] = useState<ZoneOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setData(await dnsApi.zoneOverview(connector._id, zone.id));
    } catch (err) {
      setError(getApiErrorMessage(err, `Could not load ${zone.name}`));
    } finally {
      setIsLoading(false);
    }
  }, [connector._id, zone.id, zone.name]);

  useEffect(() => {
    load();
  }, [load]);

  const z = data?.zone || zone;
  const insights = data ? zoneInsights(data) : [];
  const missing = missingPermissions(data?.capabilities ?? connector.capabilities);
  const dash = `https://dash.cloudflare.com/${z.accountId}/${encodeURIComponent(z.name)}`;

  return (
    <Modal
      isOpen
      onClose={onClose}
      maxWidth="xl"
      icon={<ConnectorLogoTile kind="dns" />}
      title={z.name}
      subtitle={`Cloudflare zone · ${connector.name}`}
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          {onBack && (
            <button type="button" onClick={onBack} className="h-8 px-2.5 inline-flex items-center gap-1 rounded-md border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50">
              <ArrowLeft size={13} /> Zones
            </button>
          )}
          <span className={`px-1.5 py-0.5 rounded border text-[11px] font-semibold ${z.status === 'active' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>{z.paused ? 'paused' : z.status}</span>
          {z.plan && <span className="px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50 text-[11px] text-slate-700">{z.plan}</span>}
          {data?.zone.type && <span className="px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50 text-[11px] text-slate-700">{data.zone.type === 'full' ? 'Full setup (Cloudflare is the DNS)' : data.zone.type}</span>}
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={load} disabled={isLoading} className="h-8 px-2.5 inline-flex items-center gap-1 rounded-md border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
              {isLoading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Check again
            </button>
            <a href={dash} target="_blank" rel="noreferrer" className="h-8 px-2.5 inline-flex items-center gap-1 rounded-md border border-orange-200 text-xs font-semibold text-orange-700 hover:bg-orange-50">
              <ExternalLink size={13} /> Cloudflare dashboard
            </a>
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs" role="alert">
            {error}
          </div>
        )}

        {isLoading && !data ? (
          <div className="space-y-2" aria-busy="true">
            <p className="text-xs text-slate-500">Checking {zone.name} and www.{zone.name} from the internet…</p>
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-16 rounded-md bg-slate-100 animate-pulse" />
            ))}
          </div>
        ) : data ? (
          <>
            <Section title="What we found">
              <ul className="space-y-1.5">
                {insights.map((i) => (
                  <li key={i.title} className={`p-2.5 rounded-md border text-xs flex items-start gap-2 ${INSIGHT_STYLE[i.level]}`}>
                    {LEVEL_ICON[i.level]}
                    <div>
                      <div className="font-semibold">{i.title}</div>
                      <div className="opacity-90">{i.detail}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </Section>

            <Section title="From the internet" aside={<span className="text-[11px] text-slate-400">checked {formatRelativeTime(data.checkedAt).toLowerCase()}</span>}>
              <div className="grid grid-cols-1 gap-2">
                {data.public.map((h) => (
                  <HostCheck key={h.hostname} host={h} />
                ))}
              </div>
            </Section>

            <Section title="Zone">
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-xs">
                <div>
                  <dt className="text-slate-500">Cloudflare name servers</dt>
                  <dd className="font-mono text-slate-800">{z.nameServers.join(', ') || '—'}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Registrar</dt>
                  <dd className="text-slate-800">{data.zone.originalRegistrar || '—'}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Name servers before Cloudflare</dt>
                  <dd className="font-mono text-slate-800">{data.zone.originalNameServers?.join(', ') || '—'}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Active on Cloudflare since</dt>
                  <dd className="text-slate-800" title={formatDateTime(data.zone.activatedOn)}>
                    {data.zone.activatedOn ? `${formatDateTime(data.zone.activatedOn)} (${formatRelativeTime(data.zone.activatedOn)})` : '—'}
                  </dd>
                </div>
              </dl>
            </Section>

            <Section title="SSL/TLS and performance settings">
              {data.settings ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs">
                  {data.settings.map((s) => (
                    <div key={s.id} className="flex items-center justify-between gap-2 py-1 border-b border-slate-100">
                      <span className="text-slate-600">{SETTING_LABELS[s.id] || s.id}</span>
                      <span className={`font-mono font-semibold ${s.value === 'on' ? 'text-emerald-700' : s.value === 'off' ? 'text-slate-500' : 'text-slate-800'}`}>{s.value}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <Denied message={data.settingsError} />
              )}
            </Section>

            <Section
              title="DNS records"
              aside={
                data.records && onRecords ? (
                  <button type="button" onClick={onRecords} className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-700 hover:underline">
                    <ListTree size={12} /> Open records
                  </button>
                ) : null
              }
            >
              {data.records ? (
                <p className="text-xs text-slate-700">
                  {data.records.length} record{data.records.length === 1 ? '' : 's'}:{' '}
                  {Object.entries(data.records.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.type]: (acc[r.type] || 0) + 1 }), {}))
                    .map(([t, n]) => `${n} ${t}`)
                    .join(', ')}
                  . {data.records.filter((r) => r.proxied).length} proxied through Cloudflare.
                </p>
              ) : (
                <Denied message={data.recordsError} />
              )}
            </Section>

            <Section title="Used by DevOps Intelligence">
              {data.usedBy.length ? (
                <ul className="text-xs space-y-1">
                  {data.usedBy.map((u) => (
                    <li key={u.hostname}>
                      <span className="font-mono">{u.hostname}</span> →{' '}
                      <Link to={`/projects/${u.projectId}?tab=domains`} className="text-sky-700 hover:underline" onClick={onClose}>
                        {u.project}/{u.environment}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-500">No project environment uses this domain. It is only monitored here.</p>
              )}
            </Section>

            {missing.length > 0 && (
              <Section title="The token could see more with">
                <ul className="text-xs text-slate-700 list-disc pl-5 space-y-0.5">
                  {missing.map((m) => (
                    <li key={m} className="font-mono text-[11px]">
                      {m}
                    </li>
                  ))}
                </ul>
              </Section>
            )}
          </>
        ) : null}
      </div>
    </Modal>
  );
};
