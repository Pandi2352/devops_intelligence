import React, { useEffect, useState } from 'react';
import { AlertTriangle, ExternalLink, Loader2, Workflow } from 'lucide-react';
import { Modal } from '../common/Modal';
import { environmentApi, EnvironmentDetails, EnvironmentView } from '../../api/environmentApi';
import { getApiErrorMessage } from '../../api/client';
import { formatDateTime, formatRelativeTime } from '../../utils/format';

interface EnvironmentDetailsModalProps {
  projectId: string;
  env: EnvironmentView;
  onClose: () => void;
}

const TONE: Record<string, string> = {
  Synced: 'text-emerald-700',
  Healthy: 'text-emerald-700',
  OutOfSync: 'text-amber-700',
  Progressing: 'text-sky-700',
  Degraded: 'text-rose-700',
  Missing: 'text-slate-500',
  Succeeded: 'text-emerald-700',
  Failed: 'text-rose-700',
  Error: 'text-rose-700',
  Running: 'text-sky-700',
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="space-y-2">
    <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{title}</h4>
    {children}
  </section>
);

// What ArgoCD knows about one environment: resources it manages, sync history and the last operation.
export const EnvironmentDetailsModal: React.FC<EnvironmentDetailsModalProps> = ({ projectId, env, onClose }) => {
  const [details, setDetails] = useState<EnvironmentDetails | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    environmentApi
      .details(projectId, env.key)
      .then(setDetails)
      .catch((err) => setError(getApiErrorMessage(err, 'Could not load ArgoCD details')));
  }, [projectId, env.key]);

  return (
    <Modal
      isOpen
      onClose={onClose}
      maxWidth="xl"
      title={`${env.key.toUpperCase()} · ${env.appName}`}
      subtitle="ArgoCD application details"
      icon={
        <div className="w-9 h-9 rounded-md bg-indigo-50 border border-indigo-200 text-indigo-600 flex items-center justify-center">
          <Workflow size={18} />
        </div>
      }
    >
      {error ? (
        <div className="p-3 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs">{error}</div>
      ) : !details ? (
        <div className="flex items-center gap-2 py-6 justify-center text-xs text-slate-500">
          <Loader2 size={14} className="animate-spin" /> Asking ArgoCD…
        </div>
      ) : (
        <div className="space-y-5 text-xs">
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              ['Sync', <span key="sync" className={TONE[details.sync.status] || ''}>{details.sync.status}</span>],
              ['Health', <span key="health" className={TONE[details.health.status] || ''}>{details.health.status}</span>],
              ['Revision', <span key="revision" className="font-mono">{details.sync.revision}</span>],
              ['Policy', details.autoSync ? 'Auto-sync (prune, self-heal)' : 'Manual sync'],
            ].map(([label, value]) => (
              <div key={String(label)} className="p-2.5 rounded-md border border-slate-200">
                <dt className="text-[10px] uppercase tracking-wider text-slate-500">{label}</dt>
                <dd className="mt-0.5 font-semibold text-slate-900">{value}</dd>
              </div>
            ))}
          </dl>

          <p className="text-[11px] text-slate-600 break-all">
            Source <span className="font-mono">{details.source.repoURL}</span> · path <span className="font-mono">{details.source.path}</span> @{' '}
            <span className="font-mono">{details.source.targetRevision}</span> → namespace{' '}
            <span className="font-mono">{details.destination.namespace}</span>
          </p>

          {details.conditions.length > 0 && (
            <div className="p-2.5 rounded-md border border-amber-200 bg-amber-50 text-amber-900 space-y-1">
              {details.conditions.map((c, i) => (
                <p key={i} className="flex gap-1.5">
                  <AlertTriangle size={13} className="shrink-0 mt-px" aria-hidden />
                  <span>
                    <strong>{c.type}</strong>: {c.message}
                  </span>
                </p>
              ))}
            </div>
          )}

          <Section title={`Managed resources (${details.resources.length})`}>
            <div className="overflow-x-auto border border-slate-200 rounded-md">
              <table className="w-full text-left">
                <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
                  <tr>
                    <th scope="col" className="px-3 py-2">Kind</th>
                    <th scope="col" className="px-3 py-2">Name</th>
                    <th scope="col" className="px-3 py-2">Sync</th>
                    <th scope="col" className="px-3 py-2">Health</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {details.resources.map((r) => (
                    <tr key={`${r.kind}/${r.name}`}>
                      <td className="px-3 py-1.5 text-slate-700">{r.kind}</td>
                      <td className="px-3 py-1.5 font-mono text-slate-900">{r.name}</td>
                      <td className={`px-3 py-1.5 ${TONE[r.status] || 'text-slate-600'}`}>{r.status}</td>
                      <td className={`px-3 py-1.5 ${TONE[r.health] || 'text-slate-500'}`} title={r.healthMessage}>
                        {r.health || '–'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Section title="Sync history">
              {details.history.length === 0 ? (
                <p className="text-slate-500">No syncs yet.</p>
              ) : (
                <ul className="space-y-1">
                  {details.history.map((h) => (
                    <li key={h.id} className="flex items-center justify-between gap-2 py-1 border-b border-slate-100 last:border-b-0">
                      <span>
                        <span className="text-slate-400">#{h.id}</span> <span className="font-mono text-indigo-700">{h.revision}</span>
                        {h.initiatedBy && <span className="text-slate-500"> · {h.initiatedBy}</span>}
                      </span>
                      <span className="text-[11px] text-slate-500" title={formatDateTime(h.deployedAt)}>
                        {formatRelativeTime(h.deployedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Last operation">
              {details.operation ? (
                <div className="space-y-1.5">
                  <p>
                    <span className={`font-semibold ${TONE[details.operation.phase] || ''}`}>{details.operation.phase}</span>
                    {details.operation.initiatedBy && <span className="text-slate-500"> · by {details.operation.initiatedBy}</span>}
                    <span className="text-slate-500"> · {formatRelativeTime(details.operation.startedAt)}</span>
                  </p>
                  {details.operation.message && <p className="text-slate-600 break-words">{details.operation.message}</p>}
                  <ul className="space-y-0.5">
                    {details.operation.results.map((r) => (
                      <li key={`${r.kind}/${r.name}`} className="text-[11px] text-slate-600 truncate" title={r.message}>
                        {r.kind} <span className="font-mono">{r.name}</span>: {r.message || r.status}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-slate-500">No operation recorded.</p>
              )}
            </Section>
          </div>

          <a href={env.argoUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sky-700 font-semibold hover:underline">
            Open in ArgoCD <ExternalLink size={11} aria-hidden />
          </a>
        </div>
      )}
    </Modal>
  );
};
