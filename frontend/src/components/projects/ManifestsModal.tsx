import React, { useEffect, useState } from 'react';
import { AlertTriangle, Check, Copy, ExternalLink, FileCode2 } from 'lucide-react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { Pagination } from '../common/Pagination';
import { usePagination } from '../../hooks/usePagination';
import { EnvironmentManifests, ManifestResource, ManifestState, projectApi } from '../../api/projectApi';
import { getApiErrorMessage } from '../../api/client';

type Tab = 'files' | 'resources';

const STATE_STYLE: Record<ManifestState, { cls: string; text: string }> = {
  'in-sync': { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', text: 'The cluster matches Git.' },
  modified: { cls: 'bg-amber-50 text-amber-800 border-amber-200', text: 'The live object differs from what Git renders.' },
  missing: { cls: 'bg-rose-50 text-rose-700 border-rose-200', text: 'In Git but not in the cluster yet (not synced).' },
  extra: { cls: 'bg-slate-100 text-slate-600 border-slate-200', text: 'In the cluster only; Git no longer has it.' },
};

const CopyButton: React.FC<{ text: string }> = ({ text }) => {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      leftIcon={copied ? <Check size={12} /> : <Copy size={12} />}
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
};

const CodeView: React.FC<{ text: string; empty?: string }> = ({ text, empty = 'Empty' }) => {
  if (!text) return <div className="p-4 text-xs text-slate-400">{empty}</div>;
  const lines = text.replace(/\n$/, '').split('\n');
  return (
    <div className="overflow-auto max-h-[60vh] bg-slate-950 rounded-md">
      <table className="text-[11px] leading-5 font-mono">
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td className="select-none text-right pr-3 pl-2 text-slate-600 align-top">{i + 1}</td>
              <td className="pr-4 text-slate-100 whitespace-pre">{l || ' '}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const Banner: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="p-2.5 rounded-md bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-2" role="alert">
    <AlertTriangle size={14} className="shrink-0 mt-0.5" />
    <span>{children}</span>
  </div>
);

const resourceKey = (r: ManifestResource) => `${r.group}/${r.kind}/${r.namespace}/${r.name}`;

// The environment's manifests: GitOps source files and, per resource, desired (Git) vs. live (cluster) YAML.
export const ManifestsModal: React.FC<{ projectId: string; env: string; onClose: () => void }> = ({ projectId, env, onClose }) => {
  const [data, setData] = useState<EnvironmentManifests | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('files');
  const [filePath, setFilePath] = useState('');
  const [resKey, setResKey] = useState('');
  const [side, setSide] = useState<'desired' | 'live'>('desired');
  const resourcePager = usePagination(data?.resources || [], 12, env);

  useEffect(() => {
    projectApi
      .manifests(projectId, env)
      .then((d) => {
        setData(d);
        setFilePath(d.files.find((f) => /kustomization\.ya?ml$/.test(f.path) && f.layer === 'overlay')?.path || d.files[0]?.path || '');
        setResKey(d.resources[0] ? resourceKey(d.resources[0]) : '');
      })
      .catch((err) => setError(getApiErrorMessage(err, 'Could not load manifests')));
  }, [projectId, env]);

  const file = data?.files.find((f) => f.path === filePath);
  const resource = data?.resources.find((r) => resourceKey(r) === resKey);
  const resourceText = resource ? (side === 'desired' ? resource.desiredYaml : resource.liveYaml) : '';

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: 'files', label: 'GitOps files', badge: data?.files.length },
    { id: 'resources', label: 'Resources (Git vs cluster)', badge: data?.resources.length },
  ];

  return (
    <Modal
      isOpen
      onClose={onClose}
      maxWidth="xl"
      icon={<FileCode2 size={18} />}
      title={`Manifests · ${env}`}
      subtitle={
        data ? (
          <span className="font-mono">
            {data.gitopsRepo}/{data.overlayPath} → {data.appName} → ns/{data.namespace}
          </span>
        ) : (
          'GitOps source files and what runs in the cluster'
        )
      }
      footer={<Button onClick={onClose}>Close</Button>}
    >
      {error ? (
        <Banner>{error}</Banner>
      ) : !data ? (
        <LoadingSpinner message="Reading GitLab and ArgoCD…" />
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-1 border-b border-slate-200 overflow-x-auto" role="tablist">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={`px-3 py-1.5 -mb-px border-b-2 text-xs font-semibold whitespace-nowrap cursor-pointer ${
                  tab === t.id ? 'border-sky-600 text-sky-700' : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                {t.label}
                {t.badge !== undefined && <span className="ml-1 px-1 rounded bg-slate-100 text-slate-600 text-[10px]">{t.badge}</span>}
              </button>
            ))}
          </div>

          {tab === 'files' && (
            <>
              {data.filesError && <Banner>GitLab: {data.filesError}</Banner>}
              <div className="grid md:grid-cols-[220px_1fr] gap-3 min-h-[300px]">
                <nav className="space-y-3" aria-label="Files">
                  {(['overlay', 'base'] as const).map((layer) => {
                    const files = data.files.filter((f) => f.layer === layer);
                    if (!files.length) return null;
                    return (
                      <div key={layer}>
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">{layer === 'overlay' ? `Overlay (${env})` : 'Base (shared)'}</div>
                        <ul className="space-y-0.5">
                          {files.map((f) => (
                            <li key={f.path}>
                              <button
                                type="button"
                                onClick={() => setFilePath(f.path)}
                                className={`w-full text-left px-2 py-1 rounded text-[11px] font-mono truncate cursor-pointer ${
                                  f.path === filePath ? 'bg-sky-50 text-sky-800 font-semibold' : 'text-slate-700 hover:bg-slate-100'
                                }`}
                                title={f.path}
                              >
                                {f.path.split('/').pop()}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                  {!data.files.length && !data.filesError && <p className="text-xs text-slate-500">No files found in {data.overlayPath}.</p>}
                </nav>
                <div className="min-w-0 space-y-2">
                  {file && (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-mono text-slate-700 truncate">{file.path}</span>
                        <div className="flex items-center gap-1 shrink-0">
                          <CopyButton text={file.content} />
                          <a href={file.webUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:underline px-2">
                            Open in GitLab <ExternalLink size={11} />
                          </a>
                        </div>
                      </div>
                      <CodeView text={file.content} />
                    </>
                  )}
                </div>
              </div>
            </>
          )}

          {tab === 'resources' && (
            <>
              {data.resourcesError && <Banner>ArgoCD: {data.resourcesError}</Banner>}
              <div className="grid md:grid-cols-[260px_1fr] gap-3 min-h-[300px]">
                <ul className="space-y-0.5" aria-label="Resources">
                  {resourcePager.pageItems.map((r) => (
                    <li key={resourceKey(r)}>
                      <button
                        type="button"
                        onClick={() => setResKey(resourceKey(r))}
                        className={`w-full text-left px-2 py-1.5 rounded cursor-pointer ${resourceKey(r) === resKey ? 'bg-sky-50' : 'hover:bg-slate-100'}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-semibold text-slate-800">{r.kind}</span>
                          <span className={`px-1.5 rounded border text-[10px] font-semibold ${STATE_STYLE[r.state].cls}`}>{r.state}</span>
                        </div>
                        <div className="text-[11px] font-mono text-slate-600 truncate" title={r.name}>
                          {r.name}
                        </div>
                      </button>
                    </li>
                  ))}
                  {!data.resources.length && !data.resourcesError && <li className="text-xs text-slate-500">ArgoCD manages no resources for this app yet.</li>}
                </ul>
                {resourcePager.total > resourcePager.pageSize && (
                  <Pagination compact page={resourcePager.page} pageSize={resourcePager.pageSize} total={resourcePager.total} onPageChange={resourcePager.setPage} itemLabel="resources" />
                )}
                <div className="min-w-0 space-y-2">
                  {resource && (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs text-slate-600">
                          <span className={`mr-1.5 px-1.5 rounded border text-[10px] font-semibold ${STATE_STYLE[resource.state].cls}`}>{resource.state}</span>
                          {STATE_STYLE[resource.state].text}
                        </p>
                        <div className="flex items-center gap-1">
                          <div className="inline-flex rounded-md border border-slate-200 overflow-hidden" role="group" aria-label="Which version">
                            {(['desired', 'live'] as const).map((v) => (
                              <button
                                key={v}
                                type="button"
                                onClick={() => setSide(v)}
                                aria-pressed={side === v}
                                className={`px-2.5 py-1 text-[11px] font-semibold cursor-pointer ${side === v ? 'bg-sky-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                              >
                                {v === 'desired' ? 'Desired (Git)' : 'Live (cluster)'}
                              </button>
                            ))}
                          </div>
                          <CopyButton text={resourceText} />
                        </div>
                      </div>
                      <CodeView text={resourceText} empty={side === 'desired' ? 'Not in Git.' : 'Not in the cluster.'} />
                    </>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
};
