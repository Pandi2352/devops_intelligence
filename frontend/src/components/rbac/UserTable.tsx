import React from 'react';
import { User } from '../../types';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import { Edit3 } from 'lucide-react';

interface UserTableProps {
  users: User[];
  onEditRole: (user: User) => void;
  canManage: boolean;
}

export const UserTable: React.FC<UserTableProps> = ({ users, onEditRole, canManage }) => {
  return (
    <div className="overflow-x-auto rounded-md border border-slate-200">
      <table className="w-full text-left text-xs text-slate-700">
        <thead className="text-[11px] uppercase bg-slate-50 text-slate-600 border-b border-slate-200 font-mono font-bold">
          <tr>
            <th className="px-4 py-2.5">Member</th>
            <th className="px-4 py-2.5">Role</th>
            <th className="px-4 py-2.5">Allowed Clusters</th>
            <th className="px-4 py-2.5">Allowed Environments</th>
            <th className="px-4 py-2.5 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {users.map((u) => (
            <tr key={u.id} className="hover:bg-slate-50 transition-colors">
              <td className="px-4 py-3">
                <div className="font-bold text-slate-900">{u.name}</div>
                <div className="text-[11px] text-slate-500 font-mono">{u.email}</div>
              </td>
              <td className="px-4 py-3">
                <Badge
                  label={u.role}
                  variant={
                    u.role === 'superadmin'
                      ? 'purple'
                      : u.role === 'devops'
                      ? 'cyan'
                      : 'default'
                  }
                />
              </td>
              <td className="px-4 py-3 font-mono text-xs text-slate-700">
                {u.allowedClusters.join(', ')}
              </td>
              <td className="px-4 py-3">
                <div className="flex gap-1">
                  {u.allowedEnvironments.map((env) => (
                    <span
                      key={env}
                      className="px-1.5 py-0.5 rounded-md text-[10px] font-mono uppercase bg-slate-100 text-slate-700 border border-slate-200"
                    >
                      {env}
                    </span>
                  ))}
                </div>
              </td>
              <td className="px-4 py-3 text-right">
                {canManage && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onEditRole(u)}
                    leftIcon={<Edit3 size={12} />}
                  >
                    Edit
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
