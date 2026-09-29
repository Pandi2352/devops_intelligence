import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Cloud, Loader2, RefreshCw, Search } from 'lucide-react';
import { HostCheck } from './HostCheck';
import { hostInsights } from './domainInsights';
import { DnsZoneOverviewModal } from '../connectors/DnsZoneOverviewModal';
import { dnsApi, DomainsList } from '../../api/dnsApi';
import { getApiErrorMessage } from '../../api/client';

type Domain = DomainsList['domains'][number];

// Every domain in the connected Cloudflare accounts, used by a project or not, as the internet sees it.
// DevOps admins only (the API enforces it too).
export const CloudflareDomainsSection: React.FC = () => {
  const [data, setData] = useState<DomainsList | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Domain | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setData(await dnsApi.domains(true));
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not load Cloudflare domains'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const domains = data?.domains || [];

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
            <Cloud size={15} className="text-orange-500" fill="currentColor" aria-hidden /> Domains in Cloudflare
          </h2>
          <p className="text-[11px] text-slate-500">Every domain of your DNS connectors, also those no project uses, checked from the internet. DevOps admins only.</p>
        </div>
        <button type="button" onClick={load} disabled={isLoading} className="h-8 px-2.5 inline-flex items-center gap-1 rounded-md border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
          {isLoading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Check again
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs" role="alert">
          {error}
        </div>
      )}
      {data?.errors.map((e) => (
        <div key={e} className="p-2.5 rounded-md bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center gap-2">
          <AlertTriangle size={13} /> {e}
        </div>
      ))}

      {isLoading && !data ? (
        <div className="h-28 rounded-md bg-slate-100 animate-pulse" aria-busy="true" />
      ) : !domains.length && !error ? (
        <p className="text-xs text-slate-500 p-3 rounded-md border border-dashed border-slate-300">
          No domains. Add Cloudflare in <Link to="/connectors?tab=dns" className="text-sky-700 hover:underline">Connectors → DNS</Link>, with a token that can read your zones.
        </p>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {domains.map((d) => {
            const problems = [d.apex, d.www].flatMap((h) => (h ? hostInsights(h) : [])).filter((i) => i.level === 'bad' || i.level === 'warn');
            return (
              <div key={`${d.connectorId}/${d.zone.id}`} className="rounded-lg border border-slate-200 bg-white p-3.5 space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-mono font-bold text-slate-900">{d.zone.name}</div>
                    <div className="text-[11px] text-slate-500">
                      {d.zone.status} · {d.zone.plan || 'plan unknown'} · {d.connectorName}
                      {d.usedBy.length ? (
                        <>
                          {' '}
                          · used by{' '}
                          {d.usedBy.map((u, i) => (
                            <React.Fragment key={u.hostname}>
                              {i > 0 && ', '}
                              <Link to={`/projects/${u.projectId}?tab=domains`} className="text-sky-700 hover:underline">
                                {u.project}/{u.environment}
                              </Link>
                            </React.Fragment>
                          ))}
                        </>
                      ) : (
                        ' · not used by a project'
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpen(d)}
                    className="h-7 px-2 inline-flex items-center gap-1 rounded-md border border-slate-200 text-[11px] font-semibold text-slate-600 hover:text-sky-700 hover:bg-sky-50 shrink-0"
                  >
                    <Search size={12} /> Overview
                  </button>
                </div>
                {problems.length > 0 && (
                  <ul className="space-y-1">
                    {problems.map((p) => (
                      <li key={p.title} className={`text-[11px] px-2 py-1 rounded border ${p.level === 'bad' ? 'bg-rose-50 border-rose-200 text-rose-900' : 'bg-amber-50 border-amber-200 text-amber-900'}`}>
                        <span className="font-semibold">{p.title}:</span> {p.detail}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="grid grid-cols-1 gap-2">
                  {d.apex && <HostCheck host={d.apex} compact />}
                  {d.www && <HostCheck host={d.www} compact />}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {open && <DnsZoneOverviewModal connector={{ _id: open.connectorId, name: open.connectorName, capabilities: null }} zone={open.zone} onClose={() => setOpen(null)} />}
    </section>
  );
};
