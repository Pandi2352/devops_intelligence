import React, { useEffect, useState } from 'react';
import { PageHeader } from '../components/common/PageHeader';
import { UserTable } from '../components/rbac/UserTable';
import { EditRoleModal } from '../components/rbac/EditRoleModal';
import { Card } from '../components/common/Card';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { Shield } from 'lucide-react';
import { authApi } from '../api/authApi';
import { useAuth, DUMMY_USERS } from '../context/AuthContext';
import { User, UserRole } from '../types';

export const RbacPage: React.FC = () => {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadUsers = async () => {
    try {
      const data = await authApi.getUsers();
      if (data && data.length > 0) {
        setUsers(data);
      } else {
        // Fallback to dummy users list
        setUsers(Object.values(DUMMY_USERS));
      }
    } catch {
      setUsers(Object.values(DUMMY_USERS));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleSaveRole = async (id: string, role: UserRole, environments: string[]) => {
    try {
      const updated = await authApi.updateUserRole(id, {
        role,
        allowedEnvironments: environments,
      });
      setUsers(users.map((u) => (u.id === id ? updated : u)));
    } catch {
      // Local update for dummy mode
      setUsers(
        users.map((u) =>
          u.id === id ? { ...u, role, allowedEnvironments: environments } : u
        )
      );
    }
  };

  const canManage = currentUser?.role === 'superadmin';

  if (isLoading) return <LoadingSpinner message="Loading RBAC access control lists..." />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Role-Based Access Control (RBAC)"
        description="Manage team privileges, Kubernetes cluster authorizations, and deployment environment guardrails"
      />

      {/* Role Definitions Guide */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        {[
          {
            role: 'Superadmin',
            color: 'border-purple-200 bg-purple-50 text-purple-800',
            desc: 'Full cluster administration, user permissions, and production deployments.',
          },
          {
            role: 'DevOps',
            color: 'border-sky-200 bg-sky-50 text-sky-800',
            desc: 'Canary configuration, GitOps pipelines, ArgoCD sync, and cluster node access.',
          },
          {
            role: 'Developer',
            color: 'border-emerald-200 bg-emerald-50 text-emerald-800',
            desc: 'Deploy to dev/staging environments, view application logs, and test rollouts.',
          },
          {
            role: 'Viewer',
            color: 'border-slate-200 bg-slate-50 text-slate-700',
            desc: 'Read-only visibility for monitoring, health dashboards, and deployment logs.',
          },
        ].map((item) => (
          <div key={item.role} className={`p-3.5 rounded-md border ${item.color}`}>
            <span className="font-bold text-xs block mb-1 uppercase tracking-wider">
              {item.role}
            </span>
            <p className="text-xs text-slate-600">{item.desc}</p>
          </div>
        ))}
      </div>

      {/* Users Management */}
      <Card
        title={
          <div className="flex items-center gap-2 font-bold">
            <Shield size={17} className="text-purple-600" />
            <span>Team Members & Assigned Roles</span>
          </div>
        }
        subtitle="Granular permissions per user account"
      >
        <UserTable
          users={users}
          onEditRole={(u) => setSelectedUser(u)}
          canManage={canManage}
        />
      </Card>

      {/* Edit Role Modal */}
      <EditRoleModal
        isOpen={Boolean(selectedUser)}
        onClose={() => setSelectedUser(null)}
        user={selectedUser}
        onSave={handleSaveRole}
      />
    </div>
  );
};
