import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { User, UserRole } from '../../types';

interface EditRoleModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User | null;
  onSave: (id: string, role: UserRole, environments: string[]) => Promise<void>;
}

export const EditRoleModal: React.FC<EditRoleModalProps> = ({
  isOpen,
  onClose,
  user,
  onSave,
}) => {
  const [role, setRole] = useState<UserRole>(user?.role || 'developer');
  const [environments, setEnvironments] = useState<string[]>(
    user?.allowedEnvironments || ['dev']
  );
  const [isLoading, setIsLoading] = useState(false);

  if (!user) return null;

  const toggleEnv = (env: string) => {
    if (environments.includes(env)) {
      setEnvironments(environments.filter((e) => e !== env));
    } else {
      setEnvironments([...environments, env]);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await onSave(user.id, role, environments);
      onClose();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Edit Role: ${user.name}`}
      subtitle={user.email}
    >
      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
            Assign Platform Role
          </label>
          <div className="grid grid-cols-2 gap-2">
            {(['superadmin', 'devops', 'developer', 'viewer'] as UserRole[]).map((r) => (
              <button
                type="button"
                key={r}
                onClick={() => setRole(r)}
                className={`py-2 px-3 rounded-md border text-xs font-bold uppercase text-left transition-colors ${
                  role === r
                    ? 'border-purple-600 bg-purple-50 text-purple-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
            Allowed Deployment Environments
          </label>
          <div className="flex gap-2">
            {['dev', 'staging', 'prod'].map((env) => (
              <button
                type="button"
                key={env}
                onClick={() => toggleEnv(env)}
                className={`px-3 py-1.5 rounded-md border text-xs font-semibold uppercase transition-colors ${
                  environments.includes(env)
                    ? 'border-sky-600 bg-sky-50 text-sky-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {env}
              </button>
            ))}
          </div>
        </div>

        <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-200">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" isLoading={isLoading}>
            Save Permissions
          </Button>
        </div>
      </form>
    </Modal>
  );
};
