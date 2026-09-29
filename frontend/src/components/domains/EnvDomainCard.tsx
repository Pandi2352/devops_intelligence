import React, { useState } from 'react';
import { Check, Copy, ExternalLink, Globe, Link2, Loader2, Pencil, Play, Shuffle, Square, Trash2, Wrench, X } from 'lucide-react';
import { EnvDns, Reachability } from '../../api/dnsApi';
import { formatDateTime, formatRelativeTime } from '../../utils/format';
import { ApprovalRequiredBadge, PendingApprovalStrip } from '../environments/ApprovalNotice';
import { DNS_STATE_META, reachText } from './domainMeta';

export type DomainAction = 'configure' | 'apply' | 'remove' | 'clear' | 'start' | 'stop' | 'random' | 'reroll';

const btn =
  'h-7 px-2.5 inline-flex items-center gap-1 rounded-md text-[11px] font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
const btnSecondary = `${btn} border border-slate-300 text-slate-700 hover:bg-slate-50`;
const btnPrimary = `${btn} bg-sky-600 hover:bg-sky-700 text-white`;
const btnDanger = `${btn} text-rose-700 hover:bg-rose-50`;

const Reach: React.FC<{ r: Reachability | null; probing: boolean }> = ({ r, probing }) => {
  if (!r) return <span className="text-slate-400">{probing ? 'Checking…' : 'Not checked'}</span>;
  return (
    <span className={`inline-flex items-center gap-1 ${r.ok ? 'text-emerald-700' : 'text-rose-700'}`}>
      {r.ok ? <Check size={11} aria-hidden /> : <X size={11} aria-hidden />}
      {reachText(r)}
    </span>
  );
};

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="grid grid-cols-[84px_minmax(0,1fr)] gap-2 py-1">
    <dt className="text-[11px] text-slate-500">{label}</dt>
    <dd className="min-w-0 text-xs text-slate-800">{children}</dd>
  </div>
);

interface EnvDomainCardProps {
  env: EnvDns;
  probing: boolean;
  busy: DomainAction | null;
  onAction: (action: DomainAction, env: EnvDns) => void;
}

export const EnvDomainCard: React.FC<EnvDomainCardProps> = ({ env, probing, busy, onAction }) => {
  const [copied, setCopied] = useState(false);
  const meta = DNS_STATE_META[env.state] || DNS_STATE_META.error;
  const dns = env.dns;
  const preview = env.preview;
  const waiting = env.pendingApproval;
  const gatedTitle = waiting ? `Waiting on request: ${waiting.summary}` : undefined;
  const applyTitle = !env.canApply ? 'Needs build and deploy access on this project' : gatedTitle;
  const configTitle = env.canConfigure ? undefined : 'Only project admins set the hostname';
  const lock = env.requiresApproval ? ' (needs approval)' : '';
  const canFix = Boolean(dns) && (env.state === 'missing' || env.state === 'mismatch');
  const hasRecord = env.records.length > 0;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(preview.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: the link is still visible */
    }
  };

  return (
    <article aria-label={`${env.env} domain`} className="bg-white border border-slate-200 rounded-lg flex flex-col min-w-0">
      <header className="px-4 pt-3 pb-2.5 border-b border-slate-100 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <h3 className="text-sm font-bold font-mono text-slate-900">{env.env}</h3>
            {env.requiresApproval && <ApprovalRequiredBadge />}
          </div>
          <p className="text-[11px] font-mono text-slate-500 truncate">{env.namespace}</p>
        </div>
        <span className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded border text-[11px] font-semibold whitespace-nowrap ${meta.chip}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} aria-hidden />
          {meta.label}
        </span>
      </header>

      <div className="px-4 py-2.5 space-y-2 flex-1">
        {dns ? (
          <dl>
            <Row label="Hostname">
              <a
                href={`https://${dns.hostname}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-mono text-sky-700 hover:underline break-all"
              >
                {dns.hostname} <ExternalLink size={10} className="shrink-0" aria-hidden />
              </a>
            </Row>
            <Row label="Mode">
              {dns.mode === 'tunnel' ? (
                <>
                  Tunnel <span className="font-mono">{env.tunnel?.name || dns.tunnelId}</span>
                  {env.tunnel && (
                    <span className="text-slate-500">
                      {' '}
                      · {env.tunnel.status} · {env.tunnel.connections} connection{env.tunnel.connections === 1 ? '' : 's'}
                    </span>
                  )}
                </>
              ) : (
                <>
                  DNS record →{' '}
                  {dns.target ? <span className="font-mono break-all">{dns.target}</span> : <span className="text-slate-600">Ingress address</span>}
                </>
              )}
            </Row>
            <Row label="Proxied">{dns.mode === 'tunnel' || dns.proxied ? 'Yes, through Cloudflare' : 'No, DNS only'}</Row>
            {(dns.service || dns.port) && (
              <Row label="Service">
                <span className="font-mono">
                  {dns.service || 'auto'}
                  {dns.port ? `:${dns.port}` : ''}
                </span>
              </Row>
            )}
            <Row label="Reachable">
              <Reach r={env.reachable} probing={probing} />
            </Row>
          </dl>
        ) : (
          <p className="text-xs text-slate-500">No public hostname yet. A project admin can give this environment one on a Cloudflare domain.</p>
        )}

        {env.message && env.state !== 'not-configured' && (
          <p className={`text-[11px] rounded-md border px-2 py-1.5 ${env.state === 'ok' ? 'border-slate-200 bg-slate-50 text-slate-700' : meta.chip}`}>
            {env.message}
          </p>
        )}

        {dns && (env.expected || hasRecord) && (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <caption className="sr-only">Expected and actual Cloudflare records for {dns.hostname}</caption>
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="font-medium py-1 pr-2" scope="col">
                    <span className="sr-only">Source</span>
                  </th>
                  <th className="font-medium py-1 pr-2" scope="col">
                    Type
                  </th>
                  <th className="font-medium py-1 pr-2" scope="col">
                    Content
                  </th>
                  <th className="font-medium py-1" scope="col">
                    Proxied
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 border-t border-slate-100">
                {env.expected && (
                  <tr>
                    <th scope="row" className="py-1 pr-2 font-medium text-slate-500 text-left whitespace-nowrap" title={env.expected.origin}>
                      Expected
                    </th>
                    <td className="py-1 pr-2 font-mono">{env.expected.type}</td>
                    <td className="py-1 pr-2 font-mono break-all">{env.expected.content}</td>
                    <td className="py-1">{env.expected.proxied ? 'yes' : 'no'}</td>
                  </tr>
                )}
                {env.records.map((r) => (
                  <tr key={r.id}>
                    <th scope="row" className="py-1 pr-2 font-medium text-slate-500 text-left whitespace-nowrap">
                      Cloudflare
                    </th>
                    <td className="py-1 pr-2 font-mono">{r.type}</td>
                    <td className="py-1 pr-2 font-mono break-all">{r.content}</td>
                    <td className="py-1">{r.proxied ? 'yes' : 'no'}</td>
                  </tr>
                ))}
                {!hasRecord && (
                  <tr>
                    <th scope="row" className="py-1 pr-2 font-medium text-slate-500 text-left">
                      Cloudflare
                    </th>
                    <td colSpan={3} className="py-1 text-slate-500">
                      No record yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {waiting && <PendingApprovalStrip pending={{ ...waiting, status: 'PENDING' }} />}
      </div>

      <div className="px-3 py-2 border-t border-slate-100 flex items-center gap-1 flex-wrap">
        <button
          type="button"
          className={btnSecondary}
          disabled={!env.canConfigure || Boolean(busy)}
          title={configTitle}
          onClick={() => onAction('configure', env)}
        >
          <Pencil size={12} aria-hidden /> {dns ? 'Edit' : 'Set hostname'}
        </button>
        {dns && hasRecord && (
          <button
            type="button"
            className={btnDanger}
            disabled={!env.canApply || Boolean(waiting) || Boolean(busy)}
            title={applyTitle || `Delete the Cloudflare record${lock}`}
            onClick={() => onAction('remove', env)}
          >
            {busy === 'remove' ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <Trash2 size={12} aria-hidden />} Remove record
          </button>
        )}
        {dns && (
          <button
            type="button"
            className={btnDanger}
            disabled={!env.canConfigure || Boolean(busy)}
            title={configTitle || 'Forget the hostname; the Cloudflare record is left in place'}
            onClick={() => onAction('clear', env)}
          >
            <X size={12} aria-hidden /> Clear hostname
          </button>
        )}
        <span className="flex-1" />
        {!dns && (
          <button
            type="button"
            className={btnPrimary}
            disabled={!env.canConfigure || Boolean(waiting) || Boolean(busy)}
            title={configTitle || `A random https://…${env.env} URL on your Cloudflare domain, through the cluster's tunnel${lock}`}
            onClick={() => onAction('random', env)}
          >
            {busy === 'random' ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <Shuffle size={12} aria-hidden />}
            {busy === 'random' ? 'Creating…' : 'Get random URL'}
          </button>
        )}
        {dns?.random && (
          <button
            type="button"
            className={btnSecondary}
            disabled={!env.canConfigure || Boolean(waiting) || Boolean(busy)}
            title={configTitle || `Replace ${dns.hostname} with a new random name; the old one stops working${lock}`}
            onClick={() => onAction('reroll', env)}
          >
            {busy === 'reroll' ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <Shuffle size={12} aria-hidden />} New random URL
          </button>
        )}
        {canFix && (
          <button
            type="button"
            className={btnPrimary}
            disabled={!env.canApply || Boolean(waiting) || Boolean(busy)}
            title={applyTitle || `Create or update the Cloudflare record${lock}`}
            onClick={() => onAction('apply', env)}
          >
            {busy === 'apply' ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <Wrench size={12} aria-hidden />}
            {env.state === 'mismatch' ? 'Fix' : 'Apply DNS'}
          </button>
        )}
      </div>

      <section className="px-4 py-3 border-t border-slate-100 bg-slate-50/60 rounded-b-lg space-y-2" aria-label={`Preview URL of ${env.env}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h4 className="text-xs font-semibold text-slate-800 flex items-center gap-1">
              <Link2 size={12} aria-hidden /> Preview URL
            </h4>
            <p className="text-[11px] text-slate-500">
              Temporary public https URL through Cloudflare (trycloudflare.com). No domain needed. Anyone with the link can open it — stop it when done.
            </p>
          </div>
          {preview.running ? (
            <button
              type="button"
              className={btnSecondary}
              disabled={!env.canApply || Boolean(busy)}
              title={env.canApply ? 'Stop the preview' : 'Needs build and deploy access on this project'}
              onClick={() => onAction('stop', env)}
            >
              {busy === 'stop' ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <Square size={11} aria-hidden />} Stop preview
            </button>
          ) : (
            <button
              type="button"
              className={btnPrimary}
              disabled={!env.canApply || Boolean(waiting) || Boolean(busy)}
              title={applyTitle || `Start a temporary preview URL${lock}`}
              onClick={() => onAction('start', env)}
            >
              {busy === 'start' ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <Play size={11} aria-hidden />}
              {busy === 'start' ? 'Starting…' : 'Start preview'}
            </button>
          )}
        </div>
        {busy === 'start' && <p className="text-[11px] text-sky-800">Starting the preview can take up to 40 seconds.</p>}
        {preview.running && (
          <dl className="text-xs">
            <Row label="URL">
              {preview.url ? (
                <span className="inline-flex items-center gap-1 min-w-0 max-w-full">
                  <a href={preview.url} target="_blank" rel="noreferrer" className="font-mono text-sky-700 hover:underline truncate">
                    {preview.url.replace(/^https?:\/\//, '')}
                  </a>
                  <button
                    type="button"
                    onClick={copy}
                    className="p-1 rounded text-slate-500 hover:text-slate-800 hover:bg-slate-100 shrink-0"
                    aria-label="Copy preview URL"
                    title={copied ? 'Copied' : 'Copy URL'}
                  >
                    {copied ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
                  </button>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-sky-800">
                  <Loader2 size={11} className="animate-spin" aria-hidden /> Starting…{preview.reason ? ` (${preview.reason})` : ''}
                </span>
              )}
            </Row>
            {preview.url && (
              <Row label="State">
                {preview.ready ? 'Ready' : `Not ready${preview.reason ? `: ${preview.reason}` : ''}`}
              </Row>
            )}
            <Row label="Started">
              <span title={formatDateTime(preview.startedAt)}>
                {formatRelativeTime(preview.startedAt)}
                {preview.startedBy ? ` by ${preview.startedBy}` : ''}
              </span>
            </Row>
            {preview.url && (
              <Row label="Reachable">
                <Reach r={preview.reachable} probing={probing} />
              </Row>
            )}
          </dl>
        )}
        {!preview.running && !env.canApply && (
          <p className="text-[11px] text-slate-500 flex items-center gap-1">
            <Globe size={11} aria-hidden /> Needs build and deploy access to start one.
          </p>
        )}
      </section>
    </article>
  );
};
