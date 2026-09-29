import { Link } from 'react-router-dom';
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
  const [isLoading, setIsLoading] = useState(false);

  if (!user) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await onSave(user.id, role, []);
      onClose();
    } catch {
      // onSave already reported the error; keep the dialog open to retry
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

        <p className="text-[11px] text-slate-500">
          Developers and Viewers only get the projects and environments granted in{' '}
          <Link to="/authorization/users" className="text-sky-700 hover:underline" onClick={onClose}>
            User Permissions
          </Link>
          . Only a Super Admin can give the Super Admin or DevOps role.
        </p>

        <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-200">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" isLoading={isLoading}>
            Save role
          </Button>
        </div>
      </form>
    </Modal>
  );
};
