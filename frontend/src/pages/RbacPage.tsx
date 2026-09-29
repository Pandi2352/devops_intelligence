import React, { useEffect, useState } from 'react';
import { PageHeader } from '../components/common/PageHeader';
import { UserTable } from '../components/rbac/UserTable';
import { EditRoleModal } from '../components/rbac/EditRoleModal';
import { Card } from '../components/common/Card';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { AlertTriangle, Search, Shield } from 'lucide-react';
import { authApi } from '../api/authApi';
import api, { getApiErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { usePagination } from '../hooks/usePagination';
import { Pagination } from '../components/common/Pagination';
import { Dropdown } from '../components/common/Dropdown';
import { User, UserRole } from '../types';

export const RbacPage: React.FC = () => {
  const { isManager } = useAuth();
  const toast = useToast();
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadUsers = async () => {
    try {
      const data = await authApi.getUsers();
      setUsers(data || []);
      setError(null);
    } catch (err) {
      setUsers([]);
      setError(getApiErrorMessage(err, 'Could not load users'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  // Environments are granted per project in Authorization → User Permissions; this dialog changes the role only.
  const handleSaveRole = async (id: string, role: UserRole) => {
    try {
      const res = await api.put(`/auth/users/${id}`, { role });
      setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, ...res.data.user } : u)));
      toast.success(res.data.message || 'Role updated');
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not change the role'));
      throw err;
    }
  };

  // DevOps admins may change developers and viewers; the API reserves admin roles for Super Admins.
  const canManage = isManager;
  const needle = query.trim().toLowerCase();
  const filtered = users.filter(
    (u) => (!needle || `${u.name} ${u.email}`.toLowerCase().includes(needle)) && (!roleFilter || u.role === roleFilter)
  );
  const pager = usePagination(filtered, 10, `${needle}|${roleFilter}`);

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
            desc: 'Everything: all projects, connectors, every user including admins, deleting projects.',
          },
          {
            role: 'DevOps',
            color: 'border-sky-200 bg-sky-50 text-sky-800',
            desc: 'All projects and connectors; manages developer and viewer accounts.',
          },
          {
            role: 'Developer',
            color: 'border-emerald-200 bg-emerald-50 text-emerald-800',
            desc: 'Only the projects and environments granted in User Permissions (view, build and deploy, admin).',
          },
          {
            role: 'Viewer',
            color: 'border-slate-200 bg-slate-50 text-slate-700',
            desc: 'Read-only, and only in the projects granted to them. Never deploys.',
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
        {error && (
          <div className="mb-3 p-2.5 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2" role="alert">
            <AlertTriangle size={14} /> {error}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search users by name or email"
              aria-label="Search users"
              className="w-full h-9 pl-8 pr-3 rounded-md border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500"
            />
          </div>
          <Dropdown<string>
            ariaLabel="Filter by role"
            value={roleFilter}
            onChange={setRoleFilter}
            options={[
              { value: '', label: 'All roles' },
              { value: 'superadmin', label: 'Super Admin' },
              { value: 'devops', label: 'DevOps' },
              { value: 'developer', label: 'Developer' },
              { value: 'viewer', label: 'Viewer' },
            ]}
          />
        </div>
        {filtered.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-500">{users.length ? 'No users match the search.' : 'No users yet.'}</p>
        ) : (
          <UserTable users={pager.pageItems} onEditRole={(u) => setSelectedUser(u)} canManage={canManage} />
        )}
        {filtered.length > 0 && (
          <Pagination
            className="mt-3"
            page={pager.page}
            pageSize={pager.pageSize}
            total={pager.total}
            onPageChange={pager.setPage}
            onPageSizeChange={pager.setPageSize}
            itemLabel="users"
          />
        )}
      </Card>

      {/* Edit Role Modal */}
      <EditRoleModal
        key={selectedUser?.id || 'none'}
        isOpen={Boolean(selectedUser)}
        onClose={() => setSelectedUser(null)}
        user={selectedUser}
        onSave={handleSaveRole}
      />
    </div>
  );
};
