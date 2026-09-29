import React from 'react';
import { Dropdown, DropdownOption } from '../common/Dropdown';
import { ObservabilityScope } from '../../hooks/useObservabilityScope';
import { sortEnvironments } from '../../utils/project';

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="min-w-0">
    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">{label}</div>
    {children}
  </div>
);

// Cluster → project → environment → namespace → pods → container. Any level can be picked directly.
export const ScopeBar: React.FC<{ scope: ObservabilityScope; showContainer?: boolean; extra?: React.ReactNode }> = ({ scope, showContainer = true, extra }) => {
  const s = scope;
  const projectOptions: DropdownOption[] = [
    { value: '', label: 'Any project', sublabel: 'pick a namespace directly' },
    ...(s.scopes?.projects || []).filter((p) => p.environments.length).map((p) => ({ value: p.id, label: p.name, sublabel: `${p.environments.length} environments` })),
  ];
  const envOptions: DropdownOption[] = s.project
    ? sortEnvironments(s.project.environments, (e) => e.name).map((e) => ({ value: e.name, label: e.name, sublabel: e.namespace }))
    : [];
  const nsOptions: DropdownOption[] = s.namespaces.map((n) => ({
    value: n.name,
    label: n.name,
    sublabel: n.project ? `${n.project} · ${n.environment}` : undefined,
  }));
  const targetOptions: DropdownOption[] = [
    { value: 'all', label: 'All pods', sublabel: s.pods ? `${s.pods.length} in namespace` : undefined },
    ...s.workloads.map((w) => ({ value: `wl:${w.kind}/${w.name}`, label: `${w.name}`, sublabel: `${w.kind} · ${w.pods} pod${w.pods === 1 ? '' : 's'}` })),
    ...(s.pods || []).map((p) => ({ value: `pod:${p.name}`, label: p.name, sublabel: `${p.status} · ${p.ready}${p.restarts ? ` · ${p.restarts} restarts` : ''}` })),
  ];
  const containerOptions: DropdownOption[] = [{ value: 'all', label: 'All containers' }, ...s.containers.map((c) => ({ value: c, label: c }))];

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 items-end">
        <Field label="Cluster">
          <Dropdown
            size="sm"
            fullWidth
            mono
            ariaLabel="Cluster"
            value={s.cluster}
            onChange={s.setCluster}
            options={(s.scopes?.clusters || []).map((c) => ({ value: c.name, label: c.name, sublabel: c.status }))}
            placeholder={s.scopes ? 'No clusters connected' : 'Loading clusters…'}
          />
        </Field>
        <Field label="Project">
          <Dropdown size="sm" fullWidth ariaLabel="Project" value={s.project?.id || ''} onChange={s.setProject} options={projectOptions} placeholder="Any project" />
        </Field>
        <Field label="Environment">
          <Dropdown
            size="sm"
            fullWidth
            mono
            ariaLabel="Environment"
            value={s.environment?.name || ''}
            onChange={s.setEnvironment}
            options={envOptions}
            placeholder={s.project ? 'Pick environment' : 'Pick a project first'}
            disabled={!s.project}
          />
        </Field>
        <Field label="Namespace">
          <Dropdown
            size="sm"
            fullWidth
            mono
            searchable
            ariaLabel="Namespace"
            value={s.namespace}
            onChange={s.setNamespace}
            options={nsOptions}
            placeholder={s.cluster ? 'Pick namespace' : 'Pick a cluster first'}
            searchPlaceholder="Search namespaces or projects"
            menuMinWidth={300}
          />
        </Field>
        <Field label="Pods">
          <Dropdown
            size="sm"
            fullWidth
            mono
            searchable
            ariaLabel="Pods"
            value={s.target}
            onChange={s.setTarget}
            options={targetOptions}
            placeholder={s.namespace ? 'All pods' : 'Pick a namespace first'}
            searchPlaceholder="Search pods or workloads"
            disabled={!s.namespace}
            menuMinWidth={340}
          />
        </Field>
        {showContainer ? (
          <Field label="Container">
            <Dropdown size="sm" fullWidth mono ariaLabel="Container" value={s.container} onChange={s.setContainer} options={containerOptions} disabled={!s.namespace} placeholder="All containers" />
          </Field>
        ) : (
          <div />
        )}
      </div>
      {extra && <div className="mt-3 pt-3 border-t border-slate-100">{extra}</div>}
    </div>
  );
};
