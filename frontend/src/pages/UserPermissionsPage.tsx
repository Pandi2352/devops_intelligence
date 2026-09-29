import React, { useState, useEffect } from 'react';
import {
  Users,
  Plus,
  HelpCircle,
  Search,
  Download,
  Trash2,
  CheckCircle2,
  Shield,
  Layers,
  Server,
  Lock,
  ChevronRight,
  X,
  RefreshCw,
  Folder,
} from 'lucide-react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { Dropdown } from '../components/common/Dropdown';

const PERMISSION_GROUPS = [
  { value: 'developer', label: 'Developer Group', sublabel: 'Access assigned project workloads & build pipelines' },
  { value: 'devops', label: 'DevOps Lead', sublabel: 'Deploy, roll out canaries, configure ArgoCD sync' },
  { value: 'viewer', label: 'Viewer Group', sublabel: 'Read-only access to metrics & logs' },
];

const STANDARD_ENVIRONMENTS = ['dev', 'qa', 'staging', 'uat', 'prod'];

const PERMISSION_OPTIONS: { value: DirectPermission['permission']; label: string }[] = [
  { value: 'View only', label: 'View only' },
  { value: 'Build and Deploy', label: 'Build and Deploy' },
  { value: 'Admin', label: 'Admin' },
  { value: 'Manager Approver', label: 'Manager Approver' },
];

const K8S_CLUSTER_OPTIONS = [
  { value: 'default_cluster (minikube)', label: 'default_cluster (minikube)' },
  { value: 'staging-cluster', label: 'staging-cluster' },
];

const K8S_NAMESPACE_OPTIONS = [
  { value: 'All Namespaces / Cluster scoped', label: 'All Namespaces / Cluster scoped' },
  { value: 'argo-apps', label: 'argo-apps' },
  { value: 'devtron-demo', label: 'devtron-demo' },
  { value: 'default', label: 'default' },
];

const K8S_API_GROUP_OPTIONS = [
  { value: 'All API groups', label: 'All API groups' },
  { value: 'apps', label: 'apps', sublabel: 'Deployments, StatefulSets' },
  { value: 'core', label: 'core', sublabel: 'Pods, ConfigMaps, Services' },
];

const K8S_KIND_OPTIONS = ['All kind', 'Pod', 'Deployment', 'Service'].map((k) => ({ value: k, label: k }));

const K8S_ROLE_OPTIONS: { value: K8sPermission['role']; label: string }[] = [
  { value: 'View', label: 'View' },
  { value: 'Edit', label: 'Edit' },
  { value: 'Admin', label: 'Admin' },
];

interface DirectPermission {
  project: string;
  environment: string;
  application: string;
  permission: 'View only' | 'Build and Deploy' | 'Admin' | 'Manager Approver';
}

interface K8sPermission {
  cluster: string;
  namespace: string;
  apiGroup: string;
  kind: string;
  resourceName: string;
  role: 'View' | 'Admin' | 'Edit';
}

interface UserItem {
  _id: string;
  name: string;
  email: string;
  role: string;
  isSuperAdmin?: boolean;
  directPermissions?: DirectPermission[];
  k8sResourcePermissions?: K8sPermission[];
  lastLogin?: string;
  createdAt?: string;
}

export const UserPermissionsPage: React.FC = () => {
  const { token, user: currentUser } = useAuth();
  const [users, setUsers] = useState<UserItem[]>([]);
  const [projectsList, setProjectsList] = useState<string[]>([]);
  // project -> its environments and ArgoCD apps, for the permission dropdowns
  const [projectEnvs, setProjectEnvs] = useState<Record<string, { envs: string[]; apps: string[] }>>({});
  const [createdInfo, setCreatedInfo] = useState<{ email: string; temporaryPassword?: string; message: string } | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [viewMode, setViewMode] = useState<'list' | 'add'>('list');

  // Add User Form State (Matches Devtron Screenshot 4 & 5)
  const [emailInput, setEmailInput] = useState<string>('');
  const [userName, setUserName] = useState<string>('');
  const [permissionType, setPermissionType] = useState<'specific' | 'superadmin'>('specific');
  const [selectedGroup, setSelectedGroup] = useState<string>('developer');
  const [activeTab, setActiveTab] = useState<'apps' | 'k8s'>('apps');

  // Direct Permissions Rows (Screenshot 4)
  const [directPermissions, setDirectPermissions] = useState<DirectPermission[]>([
    {
      project: 'argo-apps',
      environment: 'minikube / argo-apps',
      application: 'argo-apps-staging',
      permission: 'View only',
    },
  ]);

  // Kubernetes Resource Permissions Rows (Screenshot 5)
  const [k8sPermissions, setK8sPermissions] = useState<K8sPermission[]>([
    {
      cluster: 'default_cluster (minikube)',
      namespace: 'All Namespaces / Cluster scoped',
      apiGroup: 'All API groups',
      kind: 'All kind',
      resourceName: 'All resources',
      role: 'View',
    },
  ]);

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');

  const fetchUsersAndProjects = async () => {
    setIsLoading(true);
    try {
      const [usersRes, projRes] = await Promise.all([
        axios.get('/api/auth/users', { headers: { Authorization: `Bearer ${token}` } }),
        axios.get('/api/projects').catch(() => ({ data: { projects: [] } })),
      ]);

      if (usersRes.data?.users) {
        setUsers(usersRes.data.users);
      }
      const projects = (projRes.data?.projects || []) as { name: string; argoApps?: { environment?: string; branch?: string; appName: string }[] }[];
      setProjectsList(projects.map((p) => p.name));
      setProjectEnvs(
        Object.fromEntries(
          projects.map((p) => [
            p.name,
            {
              envs: (p.argoApps || []).map((a) => a.environment || a.branch || a.appName),
              apps: (p.argoApps || []).map((a) => a.appName),
            },
          ])
        )
      );
    } catch (err: any) {
      setUsers([]);
      setErrorMessage(err?.response?.data?.message || 'Could not load users');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchUsersAndProjects();
  }, []);

  const handleAddDirectPermissionRow = () => {
    setDirectPermissions([
      ...directPermissions,
      {
        project: projectsList[0] || '*',
        environment: 'minikube / default',
        application: 'all',
        permission: 'View only',
      },
    ]);
  };

  const handleRemoveDirectPermissionRow = (index: number) => {
    setDirectPermissions(directPermissions.filter((_, i) => i !== index));
  };

  const handleUpdateDirectPermission = (
    index: number,
    field: keyof DirectPermission,
    value: string
  ) => {
    const updated = [...directPermissions];
    updated[index] = { ...updated[index], [field]: value };
    setDirectPermissions(updated);
  };

  const handleAddK8sPermissionRow = () => {
    setK8sPermissions([
      ...k8sPermissions,
      {
        cluster: 'default_cluster (minikube)',
        namespace: 'All Namespaces / Cluster scoped',
        apiGroup: 'All API groups',
        kind: 'All kind',
        resourceName: 'All resources',
        role: 'View',
      },
    ]);
  };

  const handleRemoveK8sPermissionRow = (index: number) => {
    setK8sPermissions(k8sPermissions.filter((_, i) => i !== index));
  };

  const handleUpdateK8sPermission = (
    index: number,
    field: keyof K8sPermission,
    value: string
  ) => {
    const updated = [...k8sPermissions];
    updated[index] = { ...updated[index], [field]: value };
    setK8sPermissions(updated);
  };

  const handleSubmitUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailInput.trim()) {
      setErrorMessage('Please enter a valid email address');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');

    const payload = {
      email: emailInput.trim().toLowerCase(),
      name: userName.trim() || emailInput.split('@')[0],
      isSuperAdmin: permissionType === 'superadmin',
      role: permissionType === 'superadmin' ? 'superadmin' : selectedGroup,
      directPermissions: permissionType === 'superadmin' ? [] : directPermissions,
      k8sResourcePermissions: permissionType === 'superadmin' ? [] : k8sPermissions,
    };

    try {
      const res = await axios.post('/api/auth/users', payload, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setCreatedInfo({ email: payload.email, temporaryPassword: res.data?.temporaryPassword, message: res.data?.message || 'User created' });
      setViewMode('list');
      resetAddUserForm();
      fetchUsersAndProjects();
    } catch (err: any) {
      setErrorMessage(err.response?.data?.message || 'Failed to assign user permissions');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteUser = async (id: string, email: string) => {
    if (!window.confirm(`Are you sure you want to revoke access and delete user '${email}'?`)) return;
    try {
      await axios.delete(`/api/auth/users/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      fetchUsersAndProjects();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to delete user');
    }
  };

  const resetAddUserForm = () => {
    setEmailInput('');
    setUserName('');
    setPermissionType('specific');
    setSelectedGroup('developer');
    setDirectPermissions([
      {
        project: projectsList[0] || '*',
        environment: 'minikube / argo-apps',
        application: 'all',
        permission: 'View only',
      },
    ]);
    setK8sPermissions([
      {
        cluster: 'default_cluster (minikube)',
        namespace: 'All Namespaces / Cluster scoped',
        apiGroup: 'All API groups',
        kind: 'All kind',
        resourceName: 'All resources',
        role: 'View',
      },
    ]);
    setErrorMessage('');
  };

  const filteredUsers = users.filter((u) =>
    u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {createdInfo && (
        <div className="p-3 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-900 text-xs space-y-1.5" role="status">
          <div className="flex items-center justify-between gap-2">
            <strong>{createdInfo.message}</strong>
            <button type="button" onClick={() => setCreatedInfo(null)} className="text-emerald-800 hover:underline">
              Dismiss
            </button>
          </div>
          {createdInfo.temporaryPassword && (
            <div className="flex flex-wrap items-center gap-2">
              <span>
                Temporary password for <span className="font-mono">{createdInfo.email}</span>:
              </span>
              <code className="px-2 py-0.5 rounded bg-white border border-emerald-200 font-mono select-all">{createdInfo.temporaryPassword}</code>
              <button type="button" onClick={() => navigator.clipboard?.writeText(createdInfo.temporaryPassword || '')} className="underline">
                Copy
              </button>
              <span className="text-emerald-800">Shown once. They must change it at first sign-in.</span>
            </div>
          )}
        </div>
      )}
      {/* View Mode: List Users (Screenshot 3) */}
      {viewMode === 'list' && (
        <>
          {/* Header Row */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">User Permissions</h1>
              <span
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
                title="Manage user access and granular project-level permissions."
              >
                <HelpCircle size={17} />
              </span>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => fetchUsersAndProjects()}
                className="p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-md border border-slate-200 transition-colors"
                title="Refresh user list"
              >
                <RefreshCw size={15} className={isLoading ? 'animate-spin' : ''} />
              </button>

              <button
                onClick={() => {
                  resetAddUserForm();
                  setViewMode('add');
                }}
                className="flex items-center gap-1.5 px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold rounded-md transition-colors shadow-none cursor-pointer"
              >
                <Plus size={16} />
                <span>+ Add Users</span>
              </button>
            </div>
          </div>

          {/* Search Bar + Export Tools */}
          <div className="flex items-center justify-between gap-4">
            <div className="relative max-w-sm w-full">
              <Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search user..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 bg-white border border-slate-200 rounded-md text-xs text-slate-900 placeholder:text-slate-400 focus:border-sky-500"
              />
            </div>
            <button
              className="p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-md border border-slate-200 transition-colors"
              title="Download CSV"
            >
              <Download size={15} />
            </button>
          </div>

          {/* Users Table matching Screenshot 3 */}
          <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
                  <th className="py-2.5 px-4 w-10">
                    <input type="checkbox" className="rounded-md border-slate-300" />
                  </th>
                  <th className="py-2.5 px-4">Email</th>
                  <th className="py-2.5 px-4">Role / Scope</th>
                  <th className="py-2.5 px-4">Assigned Projects</th>
                  <th className="py-2.5 px-4">Last Login</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-400">
                      No users found. Click <strong>+ Add Users</strong> to invite a team member.
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((u) => {
                    const initial = (u.email?.[0] || 'U').toUpperCase();
                    const isSuper = u.role === 'superadmin' || u.isSuperAdmin;

                    return (
                      <tr key={u._id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3 px-4">
                          <input type="checkbox" className="rounded-md border-slate-300" />
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2.5">
                            <div
                              className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-[11px] font-bold ${
                                isSuper ? 'bg-orange-500' : 'bg-sky-500'
                              }`}
                            >
                              {initial}
                            </div>
                            <span className="font-semibold text-slate-900 font-mono">
                              {u.email}
                            </span>
                            {isSuper && <Lock size={12} className="text-slate-400" />}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-2 py-0.5 rounded-md font-semibold text-[10px] uppercase tracking-wide border ${
                              isSuper
                                ? 'bg-orange-50 text-orange-700 border-orange-200'
                                : 'bg-sky-50 text-sky-700 border-sky-200'
                            }`}
                          >
                            {isSuper ? 'Super Admin' : u.role}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          {isSuper ? (
                            <span className="text-slate-500 italic">All Projects (Unrestricted)</span>
                          ) : u.directPermissions && u.directPermissions.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {u.directPermissions.map((dp, i) => (
                                <span
                                  key={i}
                                  className="px-1.5 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-slate-700 text-[10px] font-mono flex items-center gap-1"
                                >
                                  <Folder size={10} className="text-sky-600" />
                                  {dp.project} ({dp.permission})
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-slate-400 italic">No project assigned</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-slate-500 font-mono text-[11px]">
                          {u.lastLogin || 'Never'}
                        </td>
                        <td className="py-3 px-4 text-right">
                          {currentUser?.role === 'superadmin' && (
                            <button
                              onClick={() => handleDeleteUser(u._id, u.email)}
                              className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors"
                              title="Delete user"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* View Mode: Add User (Matches Devtron Screenshot 4 & 5) */}
      {viewMode === 'add' && (
        <div className="space-y-6 max-w-4xl">
          {/* Breadcrumb matching Screenshot 4 */}
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <button
              onClick={() => setViewMode('list')}
              className="text-sky-600 hover:underline font-medium cursor-pointer"
            >
              User Permissions
            </button>
            <ChevronRight size={14} />
            <span className="text-slate-800 font-semibold">Add User</span>
          </div>

          <form onSubmit={handleSubmitUser} className="space-y-6">
            {errorMessage && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-md">
                {errorMessage}
              </div>
            )}

            {/* Email addresses Input */}
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-slate-700">
                Email addresses <span className="text-rose-500">*</span>
              </label>
              <input
                type="email"
                required
                placeholder="Type email and press enter (e.g. dev-bob@company.com)"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-md text-xs text-slate-900 placeholder:text-slate-400 focus:border-sky-500 font-mono"
              />
            </div>

            {/* Radio: Specific permissions vs Super admin permission */}
            <div className="flex items-center gap-6 text-xs text-slate-700">
              <label className="flex items-center gap-2 cursor-pointer font-medium">
                <input
                  type="radio"
                  name="permType"
                  checked={permissionType === 'specific'}
                  onChange={() => setPermissionType('specific')}
                  className="text-sky-600 border-slate-300"
                />
                <span>Specific permissions</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer font-medium">
                <input
                  type="radio"
                  name="permType"
                  checked={permissionType === 'superadmin'}
                  onChange={() => setPermissionType('superadmin')}
                  className="text-sky-600 border-slate-300"
                />
                <span>Super admin permission</span>
              </label>
            </div>

            {/* Conditional sections if Specific permissions */}
            {permissionType === 'specific' && (
              <div className="space-y-6 pt-2">
                {/* Permission Groups */}
                <div className="space-y-1">
                  <label htmlFor="perm-group" className="block text-xs font-semibold text-slate-700">
                    Permission Groups
                  </label>
                  <Dropdown<string>
                    id="perm-group"
                    size="md"
                    fullWidth
                    value={selectedGroup}
                    onChange={setSelectedGroup}
                    options={PERMISSION_GROUPS}
                  />
                </div>

                {/* Direct Permissions Header & Tabs */}
                <div className="space-y-3 pt-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                      Direct Permissions
                    </span>
                  </div>

                  {/* Tabs: Helm Apps / Project Applications | Kubernetes Resources */}
                  <div className="flex items-center gap-4 border-b border-slate-200 text-xs">
                    <button
                      type="button"
                      onClick={() => setActiveTab('apps')}
                      className={`pb-2 font-semibold transition-colors border-b-2 ${
                        activeTab === 'apps'
                          ? 'border-sky-600 text-sky-700'
                          : 'border-transparent text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      Project &amp; Helm Apps
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab('k8s')}
                      className={`pb-2 font-semibold transition-colors border-b-2 ${
                        activeTab === 'k8s'
                          ? 'border-sky-600 text-sky-700'
                          : 'border-transparent text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      Kubernetes Resources
                    </button>
                  </div>

                  {/* Tab 1: Project & Helm Apps Row Table (Screenshot 4) */}
                  {activeTab === 'apps' && (
                    <div className="space-y-3 pt-2">
                      <div className="grid grid-cols-12 gap-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider px-1">
                        <div className="col-span-3">Project</div>
                        <div className="col-span-3">Environment / Cluster</div>
                        <div className="col-span-3">Application</div>
                        <div className="col-span-2">Permission</div>
                        <div className="col-span-1 text-center">Delete</div>
                      </div>

                      {directPermissions.map((row, idx) => (
                        <div
                          key={idx}
                          className="grid grid-cols-12 gap-2 items-center bg-white p-2 border border-slate-200 rounded-md"
                        >
                          <div className="col-span-3">
                            <Dropdown<string>
                              ariaLabel={`Project for permission ${idx + 1}`}
                              fullWidth
                              mono
                              value={row.project}
                              onChange={(v) => handleUpdateDirectPermission(idx, 'project', v)}
                              options={[
                                ...projectsList.map((p) => ({ value: p, label: p })),
                                { value: '*', label: 'All Projects' },
                              ]}
                            />
                          </div>

                          <div className="col-span-3">
                            <Dropdown<string>
                              ariaLabel={`Environment for permission ${idx + 1}`}
                              fullWidth
                              mono
                              value={row.environment}
                              onChange={(v) => handleUpdateDirectPermission(idx, 'environment', v)}
                              options={[
                                { value: 'all', label: 'All environments' },
                                ...(row.project === '*'
                                  ? STANDARD_ENVIRONMENTS
                                  : projectEnvs[row.project]?.envs || []
                                ).map((e) => ({ value: e, label: e })),
                              ]}
                            />
                          </div>

                          <div className="col-span-3">
                            <Dropdown<string>
                              ariaLabel={`Application for permission ${idx + 1}`}
                              fullWidth
                              mono
                              value={row.application}
                              onChange={(v) => handleUpdateDirectPermission(idx, 'application', v)}
                              options={[
                                { value: 'all', label: 'All applications' },
                                ...(projectEnvs[row.project]?.apps || []).map((a) => ({ value: a, label: a })),
                              ]}
                            />
                          </div>

                          <div className="col-span-2">
                            <Dropdown<DirectPermission['permission']>
                              ariaLabel={`Permission level for row ${idx + 1}`}
                              fullWidth
                              align="right"
                              value={row.permission}
                              onChange={(v) => handleUpdateDirectPermission(idx, 'permission', v)}
                              options={PERMISSION_OPTIONS}
                              buttonClassName="text-sky-800 font-semibold"
                            />
                          </div>

                          <div className="col-span-1 text-center">
                            <button
                              type="button"
                              onClick={() => handleRemoveDirectPermissionRow(idx)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      ))}

                      <button
                        type="button"
                        onClick={handleAddDirectPermissionRow}
                        className="inline-flex items-center gap-1.5 text-xs text-sky-600 hover:text-sky-700 font-semibold cursor-pointer pt-1"
                      >
                        <Plus size={14} />
                        <span>+ Add Permission</span>
                      </button>
                    </div>
                  )}

                  {/* Tab 2: Kubernetes Resources Modal/View (Screenshot 5) */}
                  {activeTab === 'k8s' && (
                    <div className="space-y-4 pt-2">
                      {k8sPermissions.map((kRow, kIdx) => (
                        <div
                          key={kIdx}
                          className="bg-white border border-slate-200 rounded-md p-4 space-y-3"
                        >
                          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                            <span className="font-bold text-xs text-slate-800 flex items-center gap-1.5">
                              <Server size={14} className="text-sky-600" />
                              Kubernetes Resource Scope #{kIdx + 1}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleRemoveK8sPermissionRow(kIdx)}
                              className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>

                          <div className="grid grid-cols-2 gap-3 text-xs">
                            <div>
                              <label htmlFor={`k8s-cluster-${kIdx}`} className="block text-[11px] text-slate-600 mb-1">Cluster</label>
                              <Dropdown<string>
                                id={`k8s-cluster-${kIdx}`}
                                fullWidth
                                mono
                                value={kRow.cluster}
                                onChange={(v) => handleUpdateK8sPermission(kIdx, 'cluster', v)}
                                options={K8S_CLUSTER_OPTIONS}
                              />
                            </div>

                            <div>
                              <label htmlFor={`k8s-namespace-${kIdx}`} className="block text-[11px] text-slate-600 mb-1">Namespace</label>
                              <Dropdown<string>
                                id={`k8s-namespace-${kIdx}`}
                                fullWidth
                                mono
                                value={kRow.namespace}
                                onChange={(v) => handleUpdateK8sPermission(kIdx, 'namespace', v)}
                                options={K8S_NAMESPACE_OPTIONS}
                              />
                            </div>

                            <div>
                              <label htmlFor={`k8s-apigroup-${kIdx}`} className="block text-[11px] text-slate-600 mb-1">API Group</label>
                              <Dropdown<string>
                                id={`k8s-apigroup-${kIdx}`}
                                fullWidth
                                mono
                                value={kRow.apiGroup}
                                onChange={(v) => handleUpdateK8sPermission(kIdx, 'apiGroup', v)}
                                options={K8S_API_GROUP_OPTIONS}
                              />
                            </div>

                            <div>
                              <label htmlFor={`k8s-kind-${kIdx}`} className="block text-[11px] text-slate-600 mb-1">Kind</label>
                              <Dropdown<string>
                                id={`k8s-kind-${kIdx}`}
                                fullWidth
                                mono
                                value={kRow.kind}
                                onChange={(v) => handleUpdateK8sPermission(kIdx, 'kind', v)}
                                options={K8S_KIND_OPTIONS}
                              />
                            </div>

                            <div>
                              <label className="block text-[11px] text-slate-600 mb-1">Resource Name</label>
                              <input
                                type="text"
                                value={kRow.resourceName}
                                onChange={(e) =>
                                  handleUpdateK8sPermission(kIdx, 'resourceName', e.target.value)
                                }
                                className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-md font-mono text-xs"
                              />
                            </div>

                            <div>
                              <label htmlFor={`k8s-role-${kIdx}`} className="block text-[11px] text-slate-600 mb-1">Role</label>
                              <Dropdown<K8sPermission['role']>
                                id={`k8s-role-${kIdx}`}
                                fullWidth
                                value={kRow.role}
                                onChange={(v) => handleUpdateK8sPermission(kIdx, 'role', v)}
                                options={K8S_ROLE_OPTIONS}
                                buttonClassName="text-sky-800 font-semibold"
                              />
                            </div>
                          </div>
                        </div>
                      ))}

                      <button
                        type="button"
                        onClick={handleAddK8sPermissionRow}
                        className="inline-flex items-center gap-1.5 text-xs text-sky-600 hover:text-sky-700 font-semibold cursor-pointer"
                      >
                        <Plus size={14} />
                        <span>+ Add another</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Submit / Cancel Buttons */}
            <div className="flex items-center gap-3 pt-4 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className="px-4 py-2 border border-slate-200 hover:bg-slate-100 rounded-md text-slate-700 text-xs font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-5 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-md text-xs font-semibold transition-colors disabled:opacity-50"
              >
                {isSubmitting ? 'Saving Permissions...' : 'Save User Permissions'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
