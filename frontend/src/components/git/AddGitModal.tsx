import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';

interface AddGitModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: {
    name: string;
    provider: 'github' | 'gitlab';
    token: string;
    baseUrl?: string;
  }) => Promise<void>;
}

export const AddGitModal: React.FC<AddGitModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
}) => {
  const [provider, setProvider] = useState<'github' | 'gitlab'>('github');
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !token) return;

    setIsLoading(true);
    setError(null);
    try {
      await onSubmit({ name, provider, token, baseUrl });
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to authenticate Git provider');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Connect Git Provider"
      subtitle="Integrate GitHub or GitLab to automate GitOps deployments"
    >
      <form onSubmit={handleSubmit} className="space-y-3.5">
        {error && (
          <div className="p-2.5 rounded-md bg-rose-50 border border-rose-200 text-rose-700 text-xs">
            {error}
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
            Select Provider
          </label>
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => setProvider('github')}
              className={`py-2 px-3 rounded-md border text-xs font-bold transition-colors ${
                provider === 'github'
                  ? 'border-sky-600 bg-sky-50 text-sky-700'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              GitHub (Cloud)
            </button>
            <button
              type="button"
              onClick={() => setProvider('gitlab')}
              className={`py-2 px-3 rounded-md border text-xs font-bold transition-colors ${
                provider === 'gitlab'
                  ? 'border-orange-600 bg-orange-50 text-orange-700'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              GitLab (Cloud / Self-Hosted)
            </button>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
            Account / Workspace Label
          </label>
          <input
            type="text"
            required
            placeholder="e.g. My Personal GitHub"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 rounded-md bg-white border border-slate-300 text-slate-900 text-sm focus:border-sky-600"
          />
        </div>

        {provider === 'gitlab' && (
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
              GitLab Server URL (optional for gitlab.com)
            </label>
            <input
              type="url"
              placeholder="https://gitlab.com or https://gitlab.mycompany.internal"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="w-full px-3 py-2 rounded-md bg-white border border-slate-300 text-slate-900 text-sm focus:border-sky-600 font-mono"
            />
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
            Personal Access Token (PAT)
          </label>
          <input
            type="password"
            required
            placeholder={
              provider === 'github'
                ? 'ghp_xxxxxxxxxxxxxxxxxxxx'
                : 'glpat-xxxxxxxxxxxxxxxxxxxx'
            }
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="w-full px-3 py-2 rounded-md bg-white border border-slate-300 text-slate-900 text-sm focus:border-sky-600 font-mono"
          />
          <p className="mt-1 text-[11px] text-slate-500">
            {provider === 'github'
              ? 'Requires repo scope permissions.'
              : 'Requires api, read_repository, read_user scopes.'}
          </p>
        </div>

        <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-200">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" isLoading={isLoading}>
            Verify & Connect
          </Button>
        </div>
      </form>
    </Modal>
  );
};
