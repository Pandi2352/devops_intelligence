import React, { useState } from 'react';
import { Check, CheckCircle2, Copy, ExternalLink } from 'lucide-react';
import type { StarterRepo } from '../../api/starterApi';
import { GitHubLogo, GitLabLogo } from '../connectors/ConnectorLogos';

const CopyBlock: React.FC<{ label: string; text: string }> = ({ label, text }) => {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-semibold text-slate-600">{label}</span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(text);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          }}
          className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-800 cursor-pointer"
          aria-label={`Copy ${label.toLowerCase()}`}
        >
          {copied ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="p-2.5 rounded-md bg-slate-900 text-slate-100 text-xs font-mono overflow-x-auto whitespace-pre-wrap">{text}</pre>
    </div>
  );
};

export const PublishedCard: React.FC<{ repo: StarterRepo; setupInstructions?: string }> = ({ repo, setupInstructions }) => {
  const folder = repo.name || repo.fullName.split('/').pop() || 'project';
  const cloneUrl = repo.url.endsWith('.git') ? repo.url : `${repo.url}.git`;
  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-4 space-y-3">
      <div className="flex items-start gap-2.5">
        <CheckCircle2 size={20} className="text-violet-600 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900">Repository created and files pushed</h3>
          <a
            href={repo.url}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1.5 text-sm text-sky-700 hover:underline break-all"
          >
            {repo.provider === 'gitlab' ? <GitLabLogo size={14} /> : <GitHubLogo size={14} />}
            {repo.fullName}
            <ExternalLink size={12} />
          </a>
          <p className="text-xs text-slate-600 mt-1">
            <span className="font-mono">{repo.branch}</span>
            {repo.commit && (
              <>
                @<span className="font-mono">{repo.commit.slice(0, 8)}</span>
              </>
            )}
            {repo.visibility && <span className="ml-2 text-slate-500">({repo.visibility})</span>}
          </p>
        </div>
      </div>
      <CopyBlock label="Clone" text={`git clone ${cloneUrl}\ncd ${folder}`} />
      {setupInstructions && <CopyBlock label="Setup" text={setupInstructions} />}
    </div>
  );
};
