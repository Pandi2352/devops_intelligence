import React, { useEffect, useState } from 'react';
import { PageHeader } from '../components/common/PageHeader';
import { StatCard } from '../components/common/StatCard';
import { Card } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import {
  Server,
  Layers,
  Workflow,
  GitBranch,
  ArrowRight,
  FolderKanban,
} from 'lucide-react';
import { clusterApi } from '../api/clusterApi';
import { Project, environmentsOf, projectApi } from '../api/projectApi';
import { EnvironmentChips } from '../components/projects/projectUi';
import { argoApi } from '../api/argoApi';
import { gitApi } from '../api/gitApi';
import { Cluster, ArgoIntegration } from '../types';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { isManager } = useAuth();
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [argo, setArgo] = useState<ArgoIntegration | null>(null);
  const [gitCount, setGitCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadDashboardData = async () => {
      try {
        const [clusterData, projectData, argoData, gitData] = await Promise.allSettled([
          clusterApi.getAll(),
          projectApi.list(),
          argoApi.getStatus(),
          gitApi.getAll(),
        ]);

        if (clusterData.status === 'fulfilled') setClusters(clusterData.value);
        if (projectData.status === 'fulfilled') setProjects(projectData.value);
        if (argoData.status === 'fulfilled') setArgo(argoData.value);
        if (gitData.status === 'fulfilled') setGitCount(gitData.value.length);
      } finally {
        setIsLoading(false);
      }
    };

    loadDashboardData();
  }, []);

  if (isLoading) return <LoadingSpinner message="Aggregating DevOps platform telemetry..." />;

  const defaultCluster = clusters.find((c) => c.isDefault) || clusters[0];
  const healthyClusters = clusters.filter((c) => c.status === 'Healthy').length;
  const argoState = !argo ? 'Not configured' : argo.status === 'Connected' ? 'Online' : argo.status === 'Error' ? 'Error' : 'Not connected';
  const environmentCount = projects.reduce((n, p) => n + p.argoApps.length, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="DevOps Flight Deck"
        description="Unified observability and management across Minikube, GitOps, and Kubernetes workloads"
        actions={
          <Button variant="primary" onClick={() => navigate('/environments')} leftIcon={<Layers size={15} />}>
            Environments
          </Button>
        }
      />

      {/* KPI Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Clusters"
          value={clusters.length}
          subtext={defaultCluster ? `Default: ${defaultCluster.name}` : 'No cluster connectors yet'}
          icon={<Server size={18} />}
          badge={
            clusters.length ? (
              <Badge label={`${healthyClusters}/${clusters.length} healthy`} variant={healthyClusters === clusters.length ? 'healthy' : 'degraded'} />
            ) : undefined
          }
        />

        <StatCard
          label="Projects"
          value={projects.length}
          subtext={`${environmentCount} environments`}
          icon={<FolderKanban size={18} />}
          iconColor="text-purple-700 bg-purple-50 border-purple-200"
        />

        <StatCard
          label="ArgoCD GitOps"
          value={argoState}
          subtext={argo?.version && argo.version !== 'unknown' ? `Version ${argo.version}` : argo ? argo.serverUrl || 'ArgoCD connector' : 'Add it in Connectors → ArgoCD'}
          icon={<Workflow size={18} />}
          iconColor="text-emerald-700 bg-emerald-50 border-emerald-200"
          badge={argo ? <Badge label={argo.status} variant={argo.status === 'Connected' ? 'healthy' : 'offline'} /> : undefined}
        />

        <StatCard
          label="Git connectors"
          value={gitCount}
          subtext={gitCount === 1 ? "GitLab account connected" : "GitLab accounts connected"}
          icon={<GitBranch size={18} />}
          iconColor="text-amber-800 bg-amber-50 border-amber-200"
        />
      </div>

      {/* Main Grid: Clusters & Canary Deployments */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Kubernetes Cluster Status */}
        <Card
          title="Kubernetes Cluster Runtime"
          subtitle="Real-time control plane and node health"
          action={
            isManager ? (
              <Button variant="ghost" size="sm" onClick={() => navigate('/connectors?tab=clusters')} rightIcon={<ArrowRight size={13} />}>
                Manage
              </Button>
            ) : undefined
          }
        >
          {defaultCluster ? (
            <div className="space-y-3.5">
              <div className="p-3.5 rounded-md bg-slate-50 border border-slate-200 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold text-slate-900">
                      {defaultCluster.name}
                    </span>
                    <Badge label={defaultCluster.status} variant={defaultCluster.status === 'Healthy' ? 'healthy' : 'offline'} withPulse={defaultCluster.status === 'Healthy'} />
                  </div>
                  <span className="text-xs text-slate-500 mt-0.5 block font-mono">
                    Type: {defaultCluster.type}
                    {defaultCluster.version && defaultCluster.version !== 'unknown' ? ` • Version: ${defaultCluster.version}` : ''}
                  </span>
                </div>
                <div className="text-right font-mono text-xs font-bold text-sky-700">
                  {defaultCluster.nodeCount} node{defaultCluster.nodeCount === 1 ? '' : 's'}
                </div>
              </div>

              {/* Every namespace of the cluster is admin information; others see their environments on Projects. */}
              {isManager && defaultCluster.namespaces?.length > 0 && (
              <div>
                <span className="text-xs font-semibold text-slate-700 uppercase tracking-wider block mb-1.5">
                  Namespaces ({defaultCluster.namespaces.length})
                </span>
                <div className="flex flex-wrap gap-1">
                  {defaultCluster.namespaces.map((ns) => (
                    <span
                      key={ns}
                      className="px-2 py-0.5 rounded-md text-xs font-mono bg-slate-100 text-slate-700 border border-slate-200"
                    >
                      {ns}
                    </span>
                  ))}
                </div>
              </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-slate-500">No cluster connector yet.{isManager ? ' Add one in Connectors → Clusters.' : ''}</div>
          )}
        </Card>

        {/* Projects and their environments */}
        <Card
          title="Projects & environments"
          subtitle="Each project deploys one app to one environment per branch"
          action={
            <Button variant="ghost" size="sm" onClick={() => navigate('/projects')} rightIcon={<ArrowRight size={13} />}>
              All projects
            </Button>
          }
        >
          {projects.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-500">
              No projects yet. Create one in Projects, then add its environments.
            </div>
          ) : (
            <div className="space-y-2.5">
              {projects.slice(0, 4).map((p) => (
                <button
                  key={p._id}
                  type="button"
                  onClick={() => navigate(`/projects/${p._id}`)}
                  className="w-full text-left p-3 rounded-md bg-slate-50 border border-slate-200 hover:border-sky-300 hover:bg-sky-50/40 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="font-bold text-slate-900 text-sm font-mono">{p.name}</div>
                    <div className="text-xs text-slate-500 truncate">{p.description || `${p.argoApps.length} environments`}</div>
                  </div>
                  {p.argoApps.length > 0 ? <EnvironmentChips names={environmentsOf(p)} /> : <span className="text-xs text-slate-400">no environments</span>}
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};
