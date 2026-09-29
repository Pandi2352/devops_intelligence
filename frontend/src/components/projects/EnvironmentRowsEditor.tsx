import React, { useEffect, useState } from 'react';
import { Boxes, CheckCircle2, GitBranch, Layers, Plus, Trash2 } from 'lucide-react';
import { Dropdown, DropdownOption } from '../common/Dropdown';
import { TextInput } from '../common/Form';
import { Button } from '../common/Button';
import { NamespaceInfo, observabilityApi } from '../../api/observabilityApi';
import { GitBranch as Branch } from '../../api/gitApi';
import { EnvRow, envNameOptions, newEnvRow, nextEnvName } from '../../utils/projectWizard';

interface Props {
  rows: EnvRow[];
  onChange: (rows: EnvRow[]) => void;
  projectName: string;
  cluster: string;
  namespaces: NamespaceInfo[];
  branches: Branch[];
  firstBranch: string;
  overlayBase: string;
  overlayEnvs: string[];
  errors: Record<string, string>;
}

type Preview = { loading: boolean; text: string; tone: 'ok' | 'warn' | 'muted' };
const previewCache = new Map<string, Preview>();

// What already runs in an existing namespace, so reusing it is a conscious choice.
const useNamespacePreview = (cluster: string, namespace: string, exists: boolean): Preview | null => {
  const key = `${cluster}/${namespace}`;
  const [preview, setPreview] = useState<Preview | null>(() => previewCache.get(key) || null);
  useEffect(() => {
    if (!exists || !cluster || !namespace) return;
    const cached = previewCache.get(key);
    if (cached) {
      setPreview(cached);
      return;
    }
    let cancelled = false;
    setPreview({ loading: true, text: 'Checking what runs there…', tone: 'muted' });
    Promise.all([observabilityApi.resources('deployment', namespace, cluster), observabilityApi.pods(namespace, cluster)])
      .then(([deploys, pods]) => {
        const notReady = pods.pods.filter((p) => p.readyCount < p.containerCount && p.status !== 'Completed').length;
        const names = deploys.rows.map((d) => `${d.name} ${d.cols.ready ?? ''}`).slice(0, 3).join(', ');
        const text = deploys.rows.length || pods.pods.length
          ? `Already running: ${deploys.rows.length} deployment${deploys.rows.length === 1 ? '' : 's'}${names ? ` (${names})` : ''}, ${pods.pods.length} pod${pods.pods.length === 1 ? '' : 's'}${notReady ? `, ${notReady} not ready` : ''}`
          : 'Existing namespace, currently empty';
        const next: Preview = { loading: false, text, tone: deploys.rows.length || pods.pods.length ? 'warn' : 'ok' };
        previewCache.set(key, next);
        if (!cancelled) setPreview(next);
      })
      .catch(() => !cancelled && setPreview({ loading: false, text: 'Could not read the namespace', tone: 'muted' }));
    return () => {
      cancelled = true;
    };
  }, [cluster, namespace, exists, key]);
  return exists ? preview : null;
};

const Row: React.FC<{
  row: EnvRow;
  index: number;
  props: Props;
  nameOptions: DropdownOption[];
  update: (patch: Partial<EnvRow>) => void;
  remove: () => void;
}> = ({ row, index, props, nameOptions, update, remove }) => {
  const { projectName, cluster, namespaces, branches, firstBranch, overlayBase, overlayEnvs, errors } = props;
  const branchExists = branches.some((b) => b.name === row.name);
  const nsInfo = namespaces.find((n) => n.name === row.namespace);
  const nsExists = Boolean(nsInfo);
  const preview = useNamespacePreview(cluster, row.namespace, nsExists);
  const suggestedNs = projectName && row.name ? `${projectName}-${row.name}` : '';

  const nsOptions: DropdownOption[] = [
    ...(suggestedNs && !namespaces.some((n) => n.name === suggestedNs) ? [{ value: suggestedNs, label: suggestedNs, sublabel: 'new: created for you' }] : []),
    ...namespaces.map((n) => {
      const ownedElsewhere = Boolean(n.project && n.project !== projectName);
      return {
        value: n.name,
        label: n.name,
        sublabel: n.project ? `used by ${n.project} · ${n.environment}` : 'existing namespace',
        disabled: ownedElsewhere,
      };
    }),
  ];

  return (
    <div className="rounded-md border border-slate-200 bg-white p-3 space-y-2">
      <div className="grid grid-cols-1 md:grid-cols-[150px_minmax(0,1fr)_minmax(0,1.3fr)_auto_auto] gap-2 items-start">
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1" htmlFor={`env-name-${row.key}`}>
            Environment
          </label>
          {row.custom ? (
            <TextInput
              id={`env-name-${row.key}`}
              mono
              value={row.name}
              invalid={Boolean(errors[`${row.key}.name`])}
              placeholder="preprod"
              onChange={(e) => {
                const name = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
                update({ name, namespace: projectName ? `${projectName}-${name}` : name, autoSync: !['prod', 'production'].includes(name) });
              }}
            />
          ) : (
            <Dropdown
              id={`env-name-${row.key}`}
              size="md"
              fullWidth
              mono
              value={row.name}
              invalid={Boolean(errors[`${row.key}.name`])}
              onChange={(v) =>
                v === '__custom__'
                  ? update({ custom: true, name: '' })
                  : update({ name: v, namespace: projectName ? `${projectName}-${v}` : v, autoSync: !['prod', 'production'].includes(v) })
              }
              options={nameOptions}
            />
          )}
        </div>

        <div>
          <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Branch</span>
          {!row.name ? (
            <div className="h-9 text-xs text-slate-400 flex items-center">pick an environment</div>
          ) : branchExists ? (
            <div className="h-9 px-2.5 rounded-md border border-emerald-200 bg-emerald-50 text-xs text-emerald-800 flex items-center gap-1.5 font-mono">
              <CheckCircle2 size={13} /> {row.name} (exists)
            </div>
          ) : (
            <Dropdown
              size="md"
              fullWidth
              mono
              ariaLabel={`Create branch ${row.name} from`}
              value={row.sourceBranch || firstBranch}
              onChange={(v) => update({ sourceBranch: v })}
              options={branches.map((b) => ({ value: b.name, label: `new ${row.name} from ${b.name}`, sublabel: b.commit?.title }))}
              placeholder={`new ${row.name} from ${firstBranch}`}
              menuMinWidth={280}
            />
          )}
        </div>

        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1" htmlFor={`env-ns-${row.key}`}>
            Namespace
          </label>
          <Dropdown
            id={`env-ns-${row.key}`}
            size="md"
            fullWidth
            mono
            searchable
            value={row.namespace}
            invalid={Boolean(errors[`${row.key}.namespace`])}
            onChange={(v) => update({ namespace: v })}
            options={nsOptions}
            placeholder={cluster ? 'Pick namespace' : 'Pick a cluster first'}
            disabled={!cluster}
            menuMinWidth={320}
          />
        </div>

        <div>
          <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Deploy</span>
          <label className="h-9 inline-flex items-center gap-1.5 text-xs text-slate-700 whitespace-nowrap" title="Auto: ArgoCD applies every new version. Manual: someone presses Sync (use for prod).">
            <input type="checkbox" checked={row.autoSync} onChange={(e) => update({ autoSync: e.target.checked })} />
            auto-sync
          </label>
        </div>

        <div className="md:pt-5">
          <Button size="sm" variant="ghost" onClick={remove} aria-label={`Remove environment ${index + 1}`} className="h-9">
            <Trash2 size={14} className="text-rose-600" />
          </Button>
        </div>
      </div>

      {(errors[`${row.key}.name`] || errors[`${row.key}.namespace`]) && (
        <p className="text-[11px] font-medium text-rose-600">{errors[`${row.key}.name`] || errors[`${row.key}.namespace`]}</p>
      )}

      {row.name && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
          <span className="inline-flex items-center gap-1">
            <GitBranch size={11} /> {branchExists ? `branch ${row.name} is reused` : `branch ${row.name} is created from ${row.sourceBranch || firstBranch}`}
          </span>
          <span className="inline-flex items-center gap-1">
            <Layers size={11} /> {overlayEnvs.includes(row.name) ? `overlay ${overlayBase}/${row.name} is reused` : `overlay ${overlayBase}/${row.name} is created`}
          </span>
          <span className={`inline-flex items-center gap-1 ${preview?.tone === 'warn' ? 'text-amber-700' : ''}`}>
            <Boxes size={11} /> {nsExists ? preview?.text || 'existing namespace' : `namespace ${row.namespace || '—'} is created`}
          </span>
        </div>
      )}
    </div>
  );
};

export const EnvironmentRowsEditor: React.FC<Props> = (props) => {
  const { rows, onChange, projectName, branches, firstBranch, overlayEnvs } = props;
  const options = envNameOptions(overlayEnvs, branches.map((b) => b.name));
  const used = rows.map((r) => r.name);

  const optionsFor = (row: EnvRow): DropdownOption[] => [
    ...options.map((o) => ({
      value: o,
      label: o,
      sublabel: [overlayEnvs.includes(o) && 'overlay exists', branches.some((b) => b.name === o) && 'branch exists'].filter(Boolean).join(' · ') || undefined,
      disabled: o !== row.name && used.includes(o),
    })),
    { value: '__custom__', label: 'Custom name…', sublabel: 'e.g. preprod, perf' },
  ];

  return (
    <div className="space-y-2">
      {rows.map((row, i) => (
        <Row
          key={row.key}
          row={row}
          index={i}
          props={props}
          nameOptions={optionsFor(row)}
          update={(patch) => onChange(rows.map((r) => (r.key === row.key ? { ...r, ...patch } : r)))}
          remove={() => onChange(rows.filter((r) => r.key !== row.key))}
        />
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          leftIcon={<Plus size={13} />}
          onClick={() => onChange([...rows, newEnvRow(nextEnvName(used, options), projectName, firstBranch)])}
          disabled={rows.length >= 8}
        >
          Add environment
        </Button>
        {rows.length === 0 && <span className="text-[11px] text-slate-500">You can also add environments later on the project page.</span>}
      </div>
    </div>
  );
};

