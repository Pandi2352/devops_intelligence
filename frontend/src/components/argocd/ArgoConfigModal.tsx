import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';

interface ArgoConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialUrl?: string;
  onSubmit: (data: { serverUrl: string; authToken?: string; username?: string; password?: string }) => Promise<void>;
}

export const ArgoConfigModal: React.FC<ArgoConfigModalProps> = ({
  isOpen,
  onClose,
  initialUrl = 'https://localhost:8080',
  onSubmit,
}) => {
  const [serverUrl, setServerUrl] = useState(initialUrl);
  const [authToken, setAuthToken] = useState('');
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await onSubmit({ serverUrl, authToken, username, password });
      onClose();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Configure ArgoCD Integration"
      subtitle="Connect your local or remote ArgoCD server instance"
    >
      <form onSubmit={handleSubmit} className="space-y-3.5">
        <div>
          <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
            ArgoCD Server URL
          </label>
          <input
            type="url"
            required
            placeholder="https://localhost:8080"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            className="w-full px-3 py-2 rounded-md bg-white border border-slate-300 text-slate-900 text-sm focus:border-sky-600 font-mono"
          />
          <p className="mt-1 text-[11px] text-slate-500">
            For local Minikube port-forward: <code>kubectl port-forward svc/argocd-server -n argocd 8080:443</code>
          </p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
            Admin Username
          </label>
          <input
            type="text"
            placeholder="admin"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full px-3 py-2 rounded-md bg-white border border-slate-300 text-slate-900 text-sm focus:border-sky-600 font-mono"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
            Admin Password
          </label>
          <input
            type="password"
            placeholder="ArgoCD admin password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 rounded-md bg-white border border-slate-300 text-slate-900 text-sm focus:border-sky-600 font-mono"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
            ArgoCD API Token (Optional)
          </label>
          <input
            type="password"
            placeholder="API token from argocd account generate-token"
            value={authToken}
            onChange={(e) => setAuthToken(e.target.value)}
            className="w-full px-3 py-2 rounded-md bg-white border border-slate-300 text-slate-900 text-sm focus:border-sky-600 font-mono"
          />
        </div>

        <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-200">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" isLoading={isLoading}>
            Save Configuration
          </Button>
        </div>
      </form>
    </Modal>
  );
};
