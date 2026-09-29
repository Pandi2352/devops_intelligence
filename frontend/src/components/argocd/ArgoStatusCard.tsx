import React from 'react';
import { Workflow, RefreshCw, Settings } from 'lucide-react';
import { ArgoIntegration } from '../../types';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';

interface ArgoStatusCardProps {
  integration: ArgoIntegration | null;
  onRefresh: () => void;
  onConfigure: () => void;
  isRefreshing?: boolean;
}

export const ArgoStatusCard: React.FC<ArgoStatusCardProps> = ({
  integration,
  onRefresh,
  onConfigure,
  isRefreshing = false,
}) => {
  const isConnected = integration?.status === 'Connected';

  return (
    <div className="bg-white rounded-md p-5 border border-slate-200">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-md bg-sky-50 border border-sky-200 flex items-center justify-center text-sky-700">
            <Workflow size={24} />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-base font-bold text-slate-900 tracking-tight">ArgoCD GitOps Engine</h2>
              <Badge
                label={isConnected ? 'Connected' : 'Offline / Standby'}
                variant={isConnected ? 'healthy' : 'degraded'}
                withPulse={isConnected}
              />
            </div>
            <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-2">
              <span className="font-mono text-sky-700">
                {integration?.serverUrl || 'https://localhost:8080'}
              </span>
              <span>•</span>
              <span>Version: {integration?.version || 'v2.x'}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={onRefresh}
            isLoading={isRefreshing}
            leftIcon={<RefreshCw size={13} className={isRefreshing ? 'animate-spin' : ''} />}
          >
            Check Status
          </Button>

          <Button
            variant="primary"
            size="sm"
            onClick={onConfigure}
            leftIcon={<Settings size={13} />}
          >
            Configure
          </Button>
        </div>
      </div>
    </div>
  );
};
