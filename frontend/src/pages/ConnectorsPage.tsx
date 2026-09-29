import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Activity, Cloud, Server, ShieldAlert, ShieldCheck, Workflow } from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { ScrollableTabs, TabItem } from '../components/common/ScrollableTabs';
import { ClusterConnectorTab } from '../components/connectors/ClusterConnectorTab';
import { GitLabConnectorTab } from '../components/connectors/GitLabConnectorTab';
import { gitlabStatus } from '../components/connectors/gitlabStatus';
import { ArgoConnectorTab } from '../components/connectors/ArgoConnectorTab';
import { ObservabilityConnectorTab } from '../components/connectors/ObservabilityConnectorTab';
import { DnsConnectorTab } from '../components/connectors/DnsConnectorTab';
import { SecurityConnectorTab } from '../components/connectors/SecurityConnectorTab';
import { ObservabilityLogoTile } from '../components/connectors/ObservabilityLogos';
import { ConnectorKind, ConnectorLogoTile, GitLabLogo } from '../components/connectors/ConnectorLogos';
import { ConnectorCollection } from '../components/connectors/useConnectorTab';
import { clusterApi } from '../api/clusterApi';
import { gitApi } from '../api/gitApi';
import { argoApi } from '../api/argoApi';
import { observabilityApi, ObservabilityConnector } from '../api/observabilityApi';
import { dnsApi, DnsConnector, dnsStatus } from '../api/dnsApi';
import { securityApi, SonarConnector, sonarStatus } from '../api/securityApi';
import { getApiErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { ArgoIntegration, Cluster, GitIntegration } from '../types';

type TabId = ConnectorKind | 'observability';
const TABS: TabId[] = ['clusters', 'gitlab', 'argocd', 'observability', 'dns', 'security'];

// Loads one connector list and exposes it in the shape the tabs expect.
function useCollection<T>(loader: () => Promise<T[]>, errorLabel: string): ConnectorCollection<T> {
  const [items, setItems] = useState<T[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setIsLoading(true);
    try {
      setItems(await loader());
      setError(null);
    } catch (err) {
      setError(getApiErrorMessage(err, `Could not load ${errorLabel}`));
    } finally {
      setIsLoading(false);
    }
  }, [loader, errorLabel]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { items, isLoading, error, reload, setItems };
}

const loadClusters = () => clusterApi.getAll();
const loadGitLab = async () => (await gitApi.getAll()).filter((g) => g.provider === 'gitlab');
const loadArgo = () => argoApi.getConnectors();
const loadObservability = () => observabilityApi.connectors();
const loadDns = () => dnsApi.connectors();
const loadSonar = () => securityApi.sonarConnectors();

interface SummaryCardProps {
  logo: React.ReactNode;
  label: string;
  total: number;
  healthy: number;
  isLoading: boolean;
  isActive: boolean;
  onClick: () => void;
}

const SummaryCard: React.FC<SummaryCardProps> = ({ logo, label, total, healthy, isLoading, isActive, onClick }) => {
  const failing = total - healthy;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isActive}
      className={`flex items-center gap-3 p-3.5 rounded-md border bg-white text-left transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
        isActive ? 'border-sky-500 ring-1 ring-sky-500' : 'border-slate-200 hover:border-slate-300'
      }`}
    >
      {logo}
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
        {isLoading ? (
          <div className="h-5 w-20 mt-1 rounded bg-slate-100 animate-pulse" />
        ) : (
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-xl font-bold text-slate-900">{total}</span>
            <span className="text-[11px] text-emerald-700 font-medium">{healthy} healthy</span>
            {failing > 0 && <span className="text-[11px] text-rose-700 font-medium">{failing} need attention</span>}
          </div>
        )}
      </div>
    </button>
  );
};

export const ConnectorsPage: React.FC = () => {
  const { hasRole } = useAuth();
  const canManage = hasRole(['superadmin', 'devops']);
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('tab') as TabId | null;
  const activeTab: TabId = requested && TABS.includes(requested) ? requested : 'clusters';

  const clusters = useCollection<Cluster>(loadClusters, 'clusters');
  const gitlab = useCollection<GitIntegration>(loadGitLab, 'GitLab connectors');
  const argo = useCollection<ArgoIntegration>(loadArgo, 'ArgoCD connectors');
  const observability = useCollection<ObservabilityConnector>(loadObservability, 'observability connectors');
  const dns = useCollection<DnsConnector>(loadDns, 'DNS connectors');
  const sonar = useCollection<SonarConnector>(loadSonar, 'SonarQube connectors');

  // Switching tabs drops the previous tab's search / filter / page params.
  const selectTab = (tab: TabId) => {
    if (tab !== activeTab) setSearchParams({ tab });
  };

  const counts = {
    clusters: { total: clusters.items.length, healthy: clusters.items.filter((c) => c.status === 'Healthy').length },
    gitlab: { total: gitlab.items.length, healthy: gitlab.items.filter((g) => gitlabStatus(g) === 'Connected').length },
    argocd: { total: argo.items.length, healthy: argo.items.filter((a) => a.status === 'Connected').length },
    observability: {
      total: observability.items.length,
      healthy: observability.items.filter((o) => o.isActive && o.status === 'Connected').length,
    },
    dns: { total: dns.items.length, healthy: dns.items.filter((d) => dnsStatus(d) === 'Connected').length },
    security: { total: sonar.items.length, healthy: sonar.items.filter((c) => sonarStatus(c) === 'Connected').length },
  };

  const countBadge = (n: number) => (
    <span className="px-1.5 rounded text-[10px] font-mono bg-slate-100 text-slate-700 border border-slate-200">{n}</span>
  );

  const tabs: TabItem<TabId>[] = [
    { id: 'clusters', label: 'Kubernetes Clusters', icon: <Server size={15} aria-hidden />, badge: countBadge(counts.clusters.total) },
    {
      id: 'gitlab',
      label: 'GitLab',
      icon: <GitLabLogo size={16} />,
      badge: countBadge(counts.gitlab.total),
      activeBorderColor: 'border-orange-500',
      activeTextColor: 'text-orange-700',
      activeBgColor: 'bg-orange-50/50',
    },
    {
      id: 'argocd',
      label: 'ArgoCD',
      icon: <Workflow size={15} aria-hidden />,
      badge: countBadge(counts.argocd.total),
      activeBorderColor: 'border-indigo-600',
      activeTextColor: 'text-indigo-700',
      activeBgColor: 'bg-indigo-50/50',
    },
    {
      id: 'observability',
      label: 'Observability',
      icon: <Activity size={15} aria-hidden />,
      badge: countBadge(counts.observability.total),
      activeBorderColor: 'border-orange-500',
      activeTextColor: 'text-orange-700',
      activeBgColor: 'bg-orange-50/50',
    },
    {
      id: 'dns',
      label: 'DNS',
      icon: <Cloud size={15} aria-hidden className="text-orange-500" />,
      badge: countBadge(counts.dns.total),
      activeBorderColor: 'border-orange-500',
      activeTextColor: 'text-orange-700',
      activeBgColor: 'bg-orange-50/50',
    },
    {
      id: 'security',
      label: 'Security',
      icon: <ShieldCheck size={15} aria-hidden className="text-emerald-600" />,
      badge: countBadge(counts.security.total),
      activeBorderColor: 'border-emerald-600',
      activeTextColor: 'text-emerald-700',
      activeBgColor: 'bg-emerald-50/50',
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Connectors"
        description="Credentials DevOps Intelligence uses to reach your Kubernetes clusters, GitLab, ArgoCD, Prometheus, Grafana, Loki, Cloudflare DNS and SonarQube, plus the Trivy Operator status of each cluster. Secrets are encrypted at rest and never shown again after saving."
      />

      {!canManage && (
        <div className="p-3 rounded-md border border-amber-200 bg-amber-50 text-amber-900 text-xs flex items-center gap-2">
          <ShieldAlert size={15} className="shrink-0" />
          You have read-only access. Ask a Super Admin or DevOps engineer to add or change connectors.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6 gap-3">
        <SummaryCard logo={<ConnectorLogoTile kind="clusters" size="lg" />} label="Kubernetes clusters" {...counts.clusters} isLoading={clusters.isLoading && clusters.items.length === 0} isActive={activeTab === 'clusters'} onClick={() => selectTab('clusters')} />
        <SummaryCard logo={<ConnectorLogoTile kind="gitlab" size="lg" />} label="GitLab" {...counts.gitlab} isLoading={gitlab.isLoading && gitlab.items.length === 0} isActive={activeTab === 'gitlab'} onClick={() => selectTab('gitlab')} />
        <SummaryCard logo={<ConnectorLogoTile kind="argocd" size="lg" />} label="ArgoCD" {...counts.argocd} isLoading={argo.isLoading && argo.items.length === 0} isActive={activeTab === 'argocd'} onClick={() => selectTab('argocd')} />
        <SummaryCard
          logo={<ObservabilityLogoTile kind="prometheus" size="lg" />}
          label="Observability"
          {...counts.observability}
          isLoading={observability.isLoading && observability.items.length === 0}
          isActive={activeTab === 'observability'}
          onClick={() => selectTab('observability')}
        />
        <SummaryCard logo={<ConnectorLogoTile kind="dns" size="lg" />} label="DNS · Cloudflare" {...counts.dns} isLoading={dns.isLoading && dns.items.length === 0} isActive={activeTab === 'dns'} onClick={() => selectTab('dns')} />
        <SummaryCard logo={<ConnectorLogoTile kind="security" size="lg" />} label="Security · SonarQube" {...counts.security} isLoading={sonar.isLoading && sonar.items.length === 0} isActive={activeTab === 'security'} onClick={() => selectTab('security')} />
      </div>

      <ScrollableTabs<TabId> tabs={tabs} activeTab={activeTab} onChange={selectTab} />

      <div className="space-y-4">
        {activeTab === 'clusters' && <ClusterConnectorTab collection={clusters} canManage={canManage} />}
        {activeTab === 'gitlab' && <GitLabConnectorTab collection={gitlab} canManage={canManage} />}
        {activeTab === 'argocd' && <ArgoConnectorTab collection={argo} canManage={canManage} />}
        {activeTab === 'observability' && <ObservabilityConnectorTab collection={observability} canManage={canManage} />}
        {activeTab === 'dns' && <DnsConnectorTab collection={dns} canManage={canManage} />}
        {activeTab === 'security' && <SecurityConnectorTab collection={sonar} canManage={canManage} />}
      </div>
    </div>
  );
};
