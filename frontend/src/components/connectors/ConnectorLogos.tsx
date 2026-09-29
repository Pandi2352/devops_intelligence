import React from 'react';
import { Cloud, Server, Workflow } from 'lucide-react';
import gitlabLogoUrl from '../../assets/connectors/gitlab.svg';

interface LogoProps {
  size?: number;
  className?: string;
}

// Decorative: always rendered next to a visible "GitLab" label.
export const GitLabLogo: React.FC<LogoProps> = ({ size = 18, className = '' }) => (
  <img
    src={gitlabLogoUrl}
    width={size}
    height={size}
    alt=""
    aria-hidden="true"
    draggable={false}
    className={`shrink-0 select-none ${className}`}
  />
);

export type ConnectorKind = 'clusters' | 'gitlab' | 'argocd' | 'dns';

const tileStyles: Record<ConnectorKind, string> = {
  clusters: 'bg-sky-50 border-sky-200 text-sky-600',
  gitlab: 'bg-orange-50 border-orange-200',
  argocd: 'bg-indigo-50 border-indigo-200 text-indigo-600',
  dns: 'bg-orange-50 border-orange-200 text-orange-500',
};

// Square logo tile used in tables, modals and summary cards.
export const ConnectorLogoTile: React.FC<{ kind: ConnectorKind; size?: 'sm' | 'md' | 'lg' }> = ({ kind, size = 'md' }) => {
  const box = size === 'sm' ? 'w-7 h-7' : size === 'lg' ? 'w-11 h-11' : 'w-9 h-9';
  const icon = size === 'sm' ? 15 : size === 'lg' ? 24 : 19;
  return (
    <div className={`${box} rounded-md border flex items-center justify-center shrink-0 ${tileStyles[kind]}`}>
      {kind === 'gitlab' ? (
        <GitLabLogo size={icon + 2} />
      ) : kind === 'clusters' ? (
        <Server size={icon} aria-hidden />
      ) : kind === 'dns' ? (
        <Cloud size={icon} aria-hidden fill="currentColor" />
      ) : (
        <Workflow size={icon} aria-hidden />
      )}
    </div>
  );
};
