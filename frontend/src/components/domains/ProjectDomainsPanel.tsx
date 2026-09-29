import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Info, Lock, RefreshCw } from 'lucide-react';
import { Button } from '../common/Button';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { ApprovalRequestedBanner, ReasonField } from '../environments/ApprovalNotice';
import { DnsActionResult, EnvDns, ProjectDns, envDnsApi } from '../../api/dnsApi';
import { getApiErrorMessage } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { DomainConfigModal } from './DomainConfigModal';
import { DomainAction, EnvDomainCard } from './EnvDomainCard';

const POLL_MS = 4000;
const POLL_MAX_MS = 60000;

type ConfirmKind = 'apply' | 'remove' | 'clear' | 'start' | 'random' | 'reroll';

const CONFIRM_TEXT: Record<ConfirmKind, { title: string; label: string; tone: 'danger' | 'primary' }> = {
  apply: { title: 'Apply DNS', label: 'Apply', tone: 'primary' },
  remove: { title: 'Remove the DNS record', label: 'Remove record', tone: 'danger' },
  clear: { title: 'Clear the hostname', label: 'Clear hostname', tone: 'danger' },
  start: { title: 'Start a preview URL', label: 'Start preview', tone: 'primary' },
  random: { title: 'Get a random URL', label: 'Create URL', tone: 'primary' },
  reroll: { title: 'New random URL', label: 'Replace URL', tone: 'danger' },
};

interface ProjectDomainsPanelProps {
  projectId: string;
  projectName: string;
}

export const ProjectDomainsPanel: React.FC<ProjectDomainsPanelProps> = ({ projectId, projectName }) => {
  const toast = useToast();
  const [data, setData] = useState<ProjectDns | null>(null);
  const [loading, setLoading] = useState(true);
  const [probing, setProbing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ env: string; action: DomainAction } | null>(null);
  const [editing, setEditing] = useState<EnvDns | null>(null);
  const [confirm, setConfirm] = useState<{ kind: ConfirmKind; env: EnvDns } | null>(null);
  const [reason, setReason] = useState('');
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [requested, setRequested] = useState<string | null>(null);
  const pollStart = useRef<number | null>(null);

  // probe=false answers fast; probe=true adds live HTTPS checks (a few seconds).
  const load = useCallback(
    async (probe: boolean) => {
      if (probe) setProbing(true);
      try {
        setData(await envDnsApi.get(projectId, probe));
        setError(null);
      } catch (err) {
        setError(getApiErrorMessage(err, 'Could not load the domains'));
      } finally {
        if (probe) setProbing(false);
        setLoading(false);
      }
    },
    [projectId]
  );

  const refresh = useCallback(async () => {
    await load(false);
    await load(true);
  }, [load]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // A preview is running but has no URL yet: ask again every 4 s, for at most a minute.
  const starting = Boolean(data?.environments.some((e) => e.preview.running && !e.preview.url));
  useEffect(() => {
    if (!starting) {
      if (pollStart.current !== null) {
        pollStart.current = null;
        load(true);
      }
      return;
    }
    if (pollStart.current === null) pollStart.current = Date.now();
    if (Date.now() - pollStart.current > POLL_MAX_MS) return;
    const t = setTimeout(() => load(false), POLL_MS);
    return () => clearTimeout(t);
  }, [starting, data, load]);

  const run = async (kind: DomainAction, env: EnvDns, why?: string) => {
    setBusy({ env: env.env, action: kind });
    try {
      let res: DnsActionResult | { message: string };
      if (kind === 'apply') res = await envDnsApi.apply(projectId, env.env, why);
      else if (kind === 'remove') res = await envDnsApi.removeRecord(projectId, env.env, why);
      else if (kind === 'start') res = await envDnsApi.startPreview(projectId, env.env, why);
      else if (kind === 'stop') res = await envDnsApi.stopPreview(projectId, env.env);
      else if (kind === 'random' || kind === 'reroll') res = await envDnsApi.quick(projectId, env.env, { regenerate: kind === 'reroll', reason: why });
      else res = await envDnsApi.clear(projectId, env.env);
      if ('approvalRequired' in res && res.approvalRequired) {
        setRequested(res.message || 'Approval requested');
        toast.info(res.message || 'Approval requested');
      } else {
        toast.success(res.message || 'Done');
      }
      setConfirm(null);
      await refresh();
    } catch (err) {
      const msg = getApiErrorMessage(err, 'The action failed');
      if (confirm) setConfirmError(msg);
      else toast.error(msg);
    } finally {
      setBusy(null);
    }
  };

  const onAction = (action: DomainAction, env: EnvDns) => {
    if (action === 'configure') return setEditing(env);
    if (action === 'stop') return void run('stop', env);
    // Remove and clear always ask; apply and preview only ask when a reason for the approvers is useful.
    if (action === 'remove' || action === 'clear' || action === 'reroll' || env.requiresApproval) {
      setReason('');
      setConfirmError(null);
      setConfirm({ kind: action, env });
      return;
    }
    void run(action, env);
  };

  if (loading && !data) {
    return (
      <div className="grid md:grid-cols-2 2xl:grid-cols-3 gap-3" aria-busy="true">
        {[0, 1].map((i) => (
          <div key={i} className="h-72 rounded-lg border border-slate-200 bg-white animate-pulse" />
        ))}
      </div>
    );
  }

  const connectors = data?.connectors || [];
  const noZones = connectors.length > 0 && connectors.every((c) => c.zones.length === 0);
  const confirmEnv = confirm?.env;
  const confirmHost = confirmEnv?.dns?.hostname;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-xs text-slate-600 max-w-3xl">
          Give each environment a public hostname on your Cloudflare domain, or open a temporary preview URL. Project admins set the hostname;
          anyone who can build and deploy applies the DNS record.
        </p>
        <Button
          size="sm"
          variant="secondary"
          leftIcon={<RefreshCw size={13} className={probing ? 'animate-spin' : ''} />}
          onClick={refresh}
          disabled={probing}
        >
          {probing ? 'Checking' : 'Refresh'}
        </Button>
      </div>

      {error && (
        <div className="p-3 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2" role="alert">
          <AlertTriangle size={14} className="shrink-0" /> {error}
        </div>
      )}
      {requested && <ApprovalRequestedBanner message={requested} onDismiss={() => setRequested(null)} />}

      {data && connectors.length === 0 && (
        <div className="p-3 rounded-md bg-sky-50 border border-sky-200 text-sky-900 text-xs flex items-start gap-2" role="status">
          <Info size={14} className="shrink-0 mt-px" aria-hidden />
          No DNS connector yet — a DevOps admin adds Cloudflare in Connectors → DNS. Preview URLs work without it.
        </div>
      )}
      {noZones && (
        <div className="p-3 rounded-md bg-sky-50 border border-sky-200 text-sky-900 text-xs flex items-start gap-2" role="status">
          <Info size={14} className="shrink-0 mt-px" aria-hidden />
          The Cloudflare account has no domain (zone) yet — add a domain in Cloudflare to use hostnames. Preview URLs still work.
        </div>
      )}

      {data && data.environments.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-xs text-slate-500">
          No environments you can see in {projectName} yet.
        </div>
      ) : (
        <div className="grid md:grid-cols-2 2xl:grid-cols-3 gap-3 items-start">
          {data?.environments.map((env) => (
            <EnvDomainCard key={env.env} env={env} probing={probing} busy={busy?.env === env.env ? busy.action : null} onAction={onAction} />
          ))}
        </div>
      )}

      {editing && data && (
        <DomainConfigModal
          projectId={projectId}
          projectName={projectName}
          data={data}
          env={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}

      <ConfirmDialog
        isOpen={Boolean(confirm)}
        title={confirm ? `${CONFIRM_TEXT[confirm.kind].title} · ${confirm.env.env}` : ''}
        confirmLabel={confirm ? CONFIRM_TEXT[confirm.kind].label : 'Confirm'}
        tone={confirm ? CONFIRM_TEXT[confirm.kind].tone : 'primary'}
        isLoading={Boolean(busy)}
        error={confirmError}
        onCancel={() => setConfirm(null)}
        onConfirm={() => confirm && run(confirm.kind, confirm.env, reason.trim())}
        message={
          confirm && (
            <div className="space-y-3">
              {confirm.kind === 'apply' && (
                <p>
                  Creates or updates the Cloudflare record for <span className="font-mono">{confirmHost}</span>.
                </p>
              )}
              {confirm.kind === 'remove' && (
                <p>
                  Deletes the Cloudflare record for <span className="font-mono">{confirmHost}</span>. The hostname stops working; the setting is kept so
                  you can apply it again.
                </p>
              )}
              {confirm.kind === 'clear' && (
                <p>
                  Forgets the hostname <span className="font-mono">{confirmHost}</span> for {confirm.env.env}. The Cloudflare record is left in place:
                  remove the record first if it should stop working.
                </p>
              )}
              {confirm.kind === 'random' && (
                <p>
                  Creates a random hostname like <span className="font-mono">{projectName}-{confirm.env.env}-7k2f.your-domain</span> on your Cloudflare domain, with
                  HTTPS, served through the cluster&apos;s Cloudflare Tunnel. It stays the same until you replace or remove it.
                </p>
              )}
              {confirm.kind === 'reroll' && (
                <p>
                  Replaces <span className="font-mono">{confirmHost}</span> with a new random name. The old URL stops working right away.
                </p>
              )}
              {confirm.kind === 'start' && (
                <p>Opens a temporary public trycloudflare.com URL to {confirm.env.env}. Anyone with the link can open it until it is stopped.</p>
              )}
              {confirm.kind !== 'clear' && confirm.env.requiresApproval && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 space-y-2">
                  <p className="flex items-start gap-2 text-xs text-amber-900">
                    <Lock size={14} className="shrink-0 mt-0.5" aria-hidden />
                    <span>
                      <span className="font-mono font-semibold">{confirm.env.env}</span> needs an approval: a request goes to the approvers and runs once
                      someone approves it.
                    </span>
                  </p>
                  <ReasonField id="dns-reason" value={reason} onChange={setReason} />
                </div>
              )}
            </div>
          )
        }
      />
    </section>
  );
};
