import React from 'react';
import { GitBranch, ArrowRight } from 'lucide-react';
import { GitIntegration } from '../../types';
import { Badge } from '../common/Badge';

interface GitProviderCardProps {
  integration: GitIntegration;
  onSelect: (integration: GitIntegration) => void;
  isSelected?: boolean;
}

const GithubIcon: React.FC<{ size?: number }> = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
    />
  </svg>
);

export const GitProviderCard: React.FC<GitProviderCardProps> = ({
  integration,
  onSelect,
  isSelected = false,
}) => {
  const isGithub = integration.provider === 'github';

  return (
    <div
      onClick={() => onSelect(integration)}
      className={`bg-white rounded-md p-5 border transition-colors cursor-pointer ${
        isSelected
          ? 'border-sky-600 bg-sky-50/20'
          : 'border-slate-200 hover:border-slate-300'
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-md flex items-center justify-center border ${
              isGithub
                ? 'bg-slate-100 text-slate-800 border-slate-300'
                : 'bg-orange-50 text-orange-600 border-orange-200'
            }`}
          >
            {isGithub ? <GithubIcon size={20} /> : <GitBranch size={20} />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="font-bold text-slate-900 text-sm">{integration.name}</h4>
              <Badge
                label={integration.provider}
                variant={isGithub ? 'default' : 'purple'}
              />
            </div>
            <span className="text-xs text-slate-500 font-mono">
              User: {integration.username || 'Authenticated'}
            </span>
          </div>
        </div>

        <Badge
          label={integration.isActive ? 'Connected' : 'Offline'}
          variant={integration.isActive ? 'healthy' : 'offline'}
          withPulse={integration.isActive}
        />
      </div>

      <div className="mt-3.5 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-sky-600 font-semibold">
        <span>Browse Repositories</span>
        <ArrowRight size={13} />
      </div>
    </div>
  );
};
