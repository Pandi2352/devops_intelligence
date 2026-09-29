import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, ExternalLink, Info, Lock, Play, RefreshCw, ShieldCheck, ShieldAlert, AlertTriangle } from 'lucide-react';
import { Button } from '../common/Button';
import { FormField, TextInput, Toggle } from '../common/Form';
import { Dropdown } from '../common/Dropdown';
import { AnalysisInfo, ImageReport, ProjectSecurity, securityApi } from '../../api/securityApi';
import { getApiErrorMessage } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { formatDateTime, formatRelativeTime } from '../../utils/format';
import { ANALYSIS_STATE_META, GATE_META, MEASURES, RATINGS, formatMeasure, metricLabel, totalCount } from './securityMeta';
import { RatingChip, ReleaseCheckList, SeverityCountChips } from './SecurityChips';
import { VulnerabilitiesModal } from './VulnerabilitiesModal';

const POLL_MS = 4000;
const POLL_MAX_MS = 5 * 60 * 1000;

interface ProjectSecurityPanelProps {
  projectId: string;
  projectName: string;
}

const Section: React.FC<{ title: string; icon?: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode }> = ({
  title,
  icon,
  subtitle,
  actions,
  children,
}) => (
  <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
    <header className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h2 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
          {icon}
          {title}
        </h2>
        {subtitle && <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      {actions}
    </header>
    {children}
  </section>
);

const Notice: React.FC<{ tone: 'info' | 'warn' | 'error'; children: React.ReactNode }> = ({ tone, children }) => {
  const cls =
    tone === 'error' ? 'bg-rose-50 border-rose-200 text-rose-800' : tone === 'warn' ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-sky-50 border-sky-200 text-sky-900';
  return (
    <div className={`flex items-start gap-2 p-2.5 rounded-md border text-xs ${cls}`} role={tone === 'error' ? 'alert' : undefined}>
      {tone === 'info' ? <Info size={14} className="shrink-0 mt-px" /> : <AlertTriangle size={14} className="shrink-0 mt-px" />}
      <div className="min-w-0">{children}</div>
    </div>
  );
};

const Skeleton: React.FC = () => (
  <div className="space-y-4" aria-busy="true" aria-label="Loading security data">
    {[0, 1, 2].map((i) => (
      <div key={i} className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
        <div className="h-4 w-48 rounded bg-slate-100 animate-pulse" />
        <div className="h-3 w-3/4 rounded bg-slate-100 animate-pulse" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((j) => (
            <div key={j} className="h-12 rounded bg-slate-100 animate-pulse" />
          ))}
        </div>
      </div>
    ))}
    <p className="text-[11px] text-slate-500">Asking SonarQube and the cluster… this can take a few seconds.</p>
  </div>
);

// ------------------------------------------------------------------ release readiness

const ReleaseReadiness: React.FC<{ release: ProjectSecurity['release'] }> = ({ release }) => (
  <Section
    title="Release readiness"
    icon={<ShieldCheck size={15} className="text-sky-600" />}
    subtitle="Checks run before promoting into an environment that needs approval. Approvers see these checks on the approval request."
  >
    {release.length === 0 ? (
      <p className="text-xs text-slate-500">No environment requires approval, so there are no release checks. Turn on approvals for an environment to gate promotions.</p>
    ) : (
      <div className="grid gap-3 md:grid-cols-2">
        {release.map((r) => (
          <div key={r.env} className={`rounded-md border p-3 space-y-2 ${r.blocked ? 'border-rose-300' : 'border-slate-200'}`}>
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
              Promote <span className="font-mono">{r.from || '—'}</span>
              <ArrowRight size={12} className="text-slate-400" aria-hidden />
              <span className="font-mono">{r.env}</span>
            </div>
            {r.blocked && (
              <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-rose-600 text-white text-[11px] font-semibold">
                <Lock size={11} aria-hidden /> Blocked by policy
              </div>
            )}
            {r.checks.length ? <ReleaseCheckList checks={r.checks} /> : <p className="text-[11px] text-slate-500">No checks configured.</p>}
          </div>
        ))}
      </div>
    )}
  </Section>
);

// ------------------------------------------------------------------ code quality

const AnalysisStatus: React.FC<{ analysis: AnalysisInfo }> = ({ analysis }) => {
  const state = analysis.state || 'unknown';
  const m = ANALYSIS_STATE_META[state] || ANALYSIS_STATE_META.unknown;
  const logRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [analysis.log]);
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-2.5 space-y-2" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border font-semibold ${m.chip}`}>
          {state === 'running' && <RefreshCw size={10} className="animate-spin" aria-hidden />}
          Analysis {m.label.toLowerCase()}
        </span>
        <span className="font-mono">{analysis.job}</span>
        {analysis.branch && <span>· branch <span className="font-mono">{analysis.branch}</span></span>}
        {analysis.startedAt && (
          <span title={formatDateTime(analysis.startedAt)}>
            · started {formatRelativeTime(analysis.startedAt)}
            {analysis.startedBy ? ` by ${analysis.startedBy}` : ''}
          </span>
        )}
      </div>
      {analysis.reason && <p className="text-[11px] text-rose-700 font-semibold">{analysis.reason}</p>}
      {Boolean(analysis.pending) && (
        <p className="text-[11px] text-sky-800 flex items-center gap-1">
          <RefreshCw size={10} className="animate-spin" aria-hidden /> SonarQube is processing the report…
        </p>
      )}
      {analysis.log && (
        <pre ref={logRef} className="max-h-48 overflow-auto rounded bg-slate-900 text-slate-100 text-[10px] leading-relaxed p-2 font-mono whitespace-pre-wrap break-all">
          {analysis.log}
        </pre>
      )}
    </div>
  );
};

const CodeQuality: React.FC<{
  data: ProjectSecurity;
  analysis: AnalysisInfo | null;
  starting: boolean;
  onRun: () => void;
}> = ({ data, analysis, starting, onRun }) => {
  const { connector, quality, error, pending } = data.sonar;
  const running = analysis?.state === 'running' || Boolean(analysis?.pending);
  const runDisabledReason = !data.canAnalyze
    ? 'You need build and deploy permission on this project'
    : !connector
      ? 'No SonarQube connector'
      : running
        ? 'An analysis is already running'
        : undefined;
  const gate = quality?.found ? GATE_META[quality.gate.status] || GATE_META.NONE : null;
  const failing = quality?.gate.conditions.filter((c) => c.status === 'ERROR' || c.status === 'WARN') || [];

  return (
    <Section
      title="Code quality (SonarQube)"
      icon={<ShieldAlert size={15} className="text-sky-600" />}
      subtitle={
        connector ? (
          <>
            Connector <span className="font-semibold">{connector.name}</span> · project key <span className="font-mono">{data.projectKey}</span>
          </>
        ) : undefined
      }
      actions={
        connector && (
          <div className="flex flex-col items-end gap-1">
            <Button
              size="sm"
              leftIcon={<Play size={12} />}
              onClick={onRun}
              isLoading={starting}
              disabled={Boolean(runDisabledReason) || starting}
              title={runDisabledReason || 'Run a SonarQube analysis now'}
            >
              Run analysis
            </Button>
          </div>
        )
      }
    >
      {!connector ? (
        <Notice tone="info">A DevOps admin adds SonarQube in Connectors → Security. Once it is connected, code quality for this project shows up here.</Notice>
      ) : (
        <>
          <p className="text-[11px] text-slate-500">Clones the app repository's main branch and runs sonar-scanner as a Kubernetes Job next to SonarQube.</p>
          {error && <Notice tone="warn">{error}</Notice>}
          {analysis && <AnalysisStatus analysis={analysis} />}
          {!analysis && pending > 0 && (
            <p className="text-[11px] text-sky-800 flex items-center gap-1">
              <RefreshCw size={10} className="animate-spin" aria-hidden /> SonarQube is processing the report…
            </p>
          )}

          {quality && !quality.found && (
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">Not analysed yet</span>
              <span className="text-[11px] text-slate-500">
                SonarQube has no analysis for <span className="font-mono">{quality.projectKey || data.projectKey}</span>. Run one to see the quality gate.
              </span>
            </div>
          )}

          {quality?.found && gate && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs text-slate-600">Quality gate</span>
                <span className={`px-2 py-0.5 rounded border text-xs font-bold ${gate.chip}`}>{gate.label}</span>
                {quality.lastAnalysis && (
                  <span className="text-[11px] text-slate-500" title={formatDateTime(quality.lastAnalysis.date)}>
                    Last analysis {formatRelativeTime(quality.lastAnalysis.date)}
                    {quality.lastAnalysis.revision && (
                      <>
                        {' '}
                        · revision <span className="font-mono">{quality.lastAnalysis.revision.slice(0, 10)}</span>
                      </>
                    )}
                  </span>
                )}
                {quality.dashboardUrl && (
                  <a
                    href={quality.dashboardUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:underline"
                  >
                    Open in SonarQube <ExternalLink size={11} aria-hidden />
                  </a>
                )}
              </div>
              {failing.length > 0 && (
                <ul className="rounded-md border border-rose-200 bg-rose-50 p-2 space-y-0.5 text-[11px] text-rose-800">
                  {failing.map((c) => (
                    <li key={c.metric}>
                      <span className="font-semibold">{metricLabel(c.metric)}</span>: {c.actual || '—'}{' '}
                      <span className="opacity-80">
                        ({c.comparator === 'LT' ? 'must be ≥' : c.comparator === 'GT' ? 'must be ≤' : 'threshold'} {c.threshold})
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap gap-4">
                {RATINGS.map((r) => (
                  <div key={r.key} className="flex items-center gap-1.5 text-xs text-slate-700">
                    <RatingChip value={quality.ratings[r.key]} label={r.label} />
                    {r.label}
                  </div>
                ))}
              </div>
              <dl className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
                {MEASURES.map((m) => (
                  <div key={m.key} className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2">
                    <dt className="text-[10px] uppercase tracking-wide text-slate-500">{m.label}</dt>
                    <dd className="text-sm font-bold text-slate-900 font-mono">{formatMeasure(quality.measures[m.key], m.suffix)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </>
      )}
    </Section>
  );
};

// ------------------------------------------------------------------ image vulnerabilities

const ImageVulnerabilities: React.FC<{
  environments: ProjectSecurity['environments'];
  onView: (env: string, report: ImageReport) => void;
}> = ({ environments, onView }) => (
  <Section
    title="Image vulnerabilities (Trivy)"
    icon={<ShieldAlert size={15} className="text-rose-600" />}
    subtitle="What Trivy Operator found in the images each environment runs right now."
  >
    {environments.length === 0 && <p className="text-xs text-slate-500">This project has no environments yet.</p>}
    <div className="space-y-3">
      {environments.map((e) => (
        <div key={e.env} className="rounded-md border border-slate-200">
          <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-slate-100 bg-slate-50/70">
            <span className="text-sm font-bold font-mono text-slate-900">{e.env}</span>
            <span className="text-[11px] font-mono text-slate-500">{e.namespace}</span>
            {e.requiresApproval && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-900 text-[10px] font-semibold">
                <Lock size={9} aria-hidden /> Approval required
              </span>
            )}
            <span className="ml-auto">{e.reports.length > 0 && <SeverityCountChips counts={e.totals} />}</span>
          </div>
          <div className="p-3 space-y-2">
            {e.error && <Notice tone="warn">{e.error}</Notice>}
            {e.reports.length === 0 ? (
              !e.error && (
                <p className="text-xs text-slate-500">
                  Not scanned yet — Trivy Operator scans new images within a few minutes (Connectors → Security shows its status).
                </p>
              )
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-700">
                  <caption className="sr-only">Image scans in {e.env}</caption>
                  <thead className="text-[10px] uppercase tracking-wider text-slate-500">
                    <tr>
                      <th scope="col" className="py-1.5 pr-3 font-semibold">Workload / container</th>
                      <th scope="col" className="py-1.5 pr-3 font-semibold">Image</th>
                      <th scope="col" className="py-1.5 pr-3 font-semibold">Findings</th>
                      <th scope="col" className="py-1.5 pr-3 font-semibold">Fixable</th>
                      <th scope="col" className="py-1.5 pr-3 font-semibold">Scanned</th>
                      <th scope="col" className="py-1.5 font-semibold">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {e.reports.map((r) => (
                      <tr key={r.name} className="align-middle">
                        <td className="py-2 pr-3">
                          <div className="font-mono font-semibold text-slate-900">{r.workload}</div>
                          {r.container && <div className="text-[11px] font-mono text-slate-500">{r.container}</div>}
                        </td>
                        <td className="py-2 pr-3">
                          <span className="block max-w-[260px] truncate font-mono text-[11px]" title={r.image}>
                            {r.image}
                          </span>
                        </td>
                        <td className="py-2 pr-3">
                          {totalCount(r.counts) ? <SeverityCountChips counts={r.counts} hideZero /> : <span className="text-emerald-700 font-semibold">None</span>}
                        </td>
                        <td className="py-2 pr-3 font-mono">{r.fixable}</td>
                        <td className="py-2 pr-3 whitespace-nowrap text-slate-600" title={formatDateTime(r.scannedAt)}>
                          {r.scannedAt ? formatRelativeTime(r.scannedAt) : '—'}
                        </td>
                        <td className="py-2 text-right">
                          <button
                            type="button"
                            onClick={() => onView(e.env, r)}
                            className="h-7 px-2 inline-flex items-center rounded-md border border-slate-200 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer whitespace-nowrap"
                            aria-label={`View CVEs for ${r.workload} ${r.container} in ${e.env}`}
                          >
                            View CVEs
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  </Section>
);

// ------------------------------------------------------------------ settings

const SecuritySettings: React.FC<{ projectId: string; data: ProjectSecurity; onSaved: () => void }> = ({ projectId, data, onSaved }) => {
  const toast = useToast();
  const { policy, connectors, canConfigure } = data;
  const [connectorId, setConnectorId] = useState(policy.sonarConnectorId || '');
  const [projectKey, setProjectKey] = useState(policy.sonarProjectKey || '');
  const [blockGate, setBlockGate] = useState(policy.blockOnQualityGate);
  const [blockCritical, setBlockCritical] = useState(policy.blockOnCritical);
  const [saving, setSaving] = useState(false);

  const dirty =
    connectorId !== (policy.sonarConnectorId || '') ||
    projectKey.trim() !== (policy.sonarProjectKey || '') ||
    blockGate !== policy.blockOnQualityGate ||
    blockCritical !== policy.blockOnCritical;

  const defaultConnector = connectors.find((c) => c.isDefault);
  const connectorName = (id: string) => connectors.find((c) => c.id === id)?.name;

  if (!canConfigure) {
    return (
      <Section title="Settings" subtitle="Only project admins can change these.">
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
          <dt className="text-slate-500">SonarQube connector</dt>
          <dd className="text-slate-800">{connectorName(policy.sonarConnectorId) || (defaultConnector ? `Default (${defaultConnector.name})` : 'None')}</dd>
          <dt className="text-slate-500">SonarQube project key</dt>
          <dd className="font-mono text-slate-800">
            {data.projectKey}
            {!policy.sonarProjectKey && <span className="text-slate-400 font-sans"> (derived from the project name)</span>}
          </dd>
          <dt className="text-slate-500">Block when the quality gate fails</dt>
          <dd className="text-slate-800">{policy.blockOnQualityGate ? 'Yes' : 'No'}</dd>
          <dt className="text-slate-500">Block on critical vulnerabilities</dt>
          <dd className="text-slate-800">{policy.blockOnCritical ? 'Yes' : 'No'}</dd>
        </dl>
      </Section>
    );
  }

  const save = async () => {
    setSaving(true);
    try {
      const res = await securityApi.setPolicy(projectId, {
        sonarConnectorId: connectorId,
        sonarProjectKey: projectKey.trim(),
        blockOnQualityGate: blockGate,
        blockOnCritical: blockCritical,
      });
      toast.success(res?.message || 'Security settings saved');
      onSaved();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not save the security settings'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title="Settings" subtitle="Which SonarQube project this maps to, and what blocks a promotion.">
      <div className="grid gap-3 md:grid-cols-2">
        {connectors.length > 1 && (
          <FormField id="sec-connector" label="SonarQube connector" hint="Default follows the connector marked default in Connectors → Security.">
            <Dropdown<string>
              id="sec-connector"
              value={connectorId}
              onChange={setConnectorId}
              size="md"
              fullWidth
              options={[
                { value: '', label: defaultConnector ? `Default (${defaultConnector.name})` : 'Default' },
                ...connectors.map((c) => ({ value: c.id, label: c.name, sublabel: c.isDefault ? 'default' : undefined })),
              ]}
            />
          </FormField>
        )}
        <FormField id="sec-project-key" label="SonarQube project key" hint="Empty = derived from the project name.">
          <TextInput id="sec-project-key" mono value={projectKey} onChange={(e) => setProjectKey(e.target.value)} placeholder={data.projectKey} />
        </FormField>
      </div>
      <div className="space-y-3 pt-1">
        <Toggle
          id="sec-block-gate"
          checked={blockGate}
          onChange={setBlockGate}
          label="Block promotions into gated environments when the quality gate fails"
          description="Approvers cannot approve the promotion until the gate passes."
        />
        <Toggle
          id="sec-block-critical"
          checked={blockCritical}
          onChange={setBlockCritical}
          label="Block promotions into gated environments when the promoted image has critical vulnerabilities"
          description="Uses the Trivy scan of the image running in the source environment."
        />
      </div>
      <div className="flex justify-end">
        <Button size="sm" onClick={save} isLoading={saving} disabled={!dirty || saving} title={!dirty ? 'No changes to save' : undefined}>
          Save settings
        </Button>
      </div>
    </Section>
  );
};

// ------------------------------------------------------------------ panel

export const ProjectSecurityPanel: React.FC<ProjectSecurityPanelProps> = ({ projectId, projectName }) => {
  const toast = useToast();
  const [data, setData] = useState<ProjectSecurity | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisInfo | null>(null);
  const [polling, setPolling] = useState(false);
  const [starting, setStarting] = useState(false);
  const [viewing, setViewing] = useState<{ env: string; report: ImageReport } | null>(null);
  const pollStart = useRef(0);

  const isActive = (a: AnalysisInfo | null) => Boolean(a && (a.state === 'running' || (a.pending || 0) > 0));

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await securityApi.project(projectId);
      setData(res);
      setError(null);
      return res;
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not load the security data'));
      return null;
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, [projectId]);

  // First load; if an analysis was started recently, pick up its status.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await load();
      if (cancelled || !res?.lastAnalysis) return;
      try {
        const a = await securityApi.analysis(projectId);
        if (cancelled || !a) return;
        setAnalysis(a);
        if (isActive(a)) {
          pollStart.current = Date.now();
          setPolling(true);
        }
      } catch {
        // status is optional; the quality gate is already shown
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load, projectId]);

  useEffect(() => {
    if (!polling) return;
    const timer = setTimeout(async () => {
      try {
        const a = await securityApi.analysis(projectId);
        setAnalysis(a);
        // Still running: the new `analysis` object re-runs this effect, which schedules the next poll.
        if (isActive(a) && Date.now() - pollStart.current < POLL_MAX_MS) return;
        setPolling(false);
        if (a?.state === 'failed') toast.error(`SonarQube analysis failed${a.reason ? `: ${a.reason}` : ''}`);
        else if (a?.state === 'succeeded') toast.success('SonarQube analysis finished');
        await load();
      } catch (err) {
        setPolling(false);
        toast.error(getApiErrorMessage(err, 'Could not read the analysis status'));
      }
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [polling, analysis, projectId, load, toast]);

  const runAnalysis = async () => {
    setStarting(true);
    try {
      const res = await securityApi.runAnalysis(projectId);
      toast.success(res.message || 'Analysis started');
      setAnalysis({ ...res.analysis, state: res.analysis.state || 'running' });
      pollStart.current = Date.now();
      setPolling(true);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not start the analysis'));
    } finally {
      setStarting(false);
    }
  };

  if (loading) return <Skeleton />;

  if (!data) {
    return (
      <div className="space-y-2">
        <Notice tone="error">{error || 'Could not load the security data'}</Notice>
        <Button size="sm" variant="secondary" leftIcon={<RefreshCw size={12} />} onClick={load} isLoading={refreshing}>
          Try again
        </Button>
      </div>
    );
  }

  const policyKey = JSON.stringify(data.policy);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500">
          Code quality from SonarQube and image vulnerabilities from Trivy for <span className="font-semibold">{projectName}</span>.
        </p>
        <button
          type="button"
          onClick={load}
          disabled={refreshing}
          className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 cursor-pointer disabled:opacity-60"
          aria-label="Refresh security data"
          title="Refresh"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <ReleaseReadiness release={data.release} />
      <CodeQuality data={data} analysis={analysis} starting={starting} onRun={runAnalysis} />
      <ImageVulnerabilities environments={data.environments} onView={(env, report) => setViewing({ env, report })} />
      <SecuritySettings key={policyKey} projectId={projectId} data={data} onSaved={load} />
      {viewing && <VulnerabilitiesModal projectId={projectId} env={viewing.env} report={viewing.report} onClose={() => setViewing(null)} />}
    </div>
  );
};
