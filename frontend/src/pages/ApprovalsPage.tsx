import React, { useEffect, useState } from 'react';
import { PageHeader } from '../components/common/PageHeader';
import { Badge } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { EmptyState } from '../components/common/EmptyState';
import { ShieldCheck, CheckCircle2, XCircle, Clock, AlertTriangle } from 'lucide-react';
import { approvalApi } from '../api/approvalApi';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { getApiErrorMessage } from '../api/client';
import { usePagination } from '../hooks/usePagination';
import { Pagination } from '../components/common/Pagination';
import { ApprovalRequest } from '../types';

export const ApprovalsPage: React.FC = () => {
  const { user, access, isManager } = useAuth();
  const toast = useToast();
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [isLoading, setIsLoading] = useState(true);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadApprovals = async () => {
    try {
      const data = await approvalApi.getAll();
      setApprovals(data);
      setLoadError(null);
    } catch (err) {
      setApprovals([]);
      setLoadError(getApiErrorMessage(err, 'Could not load approval requests'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadApprovals();
  }, []);

  // Admins, and Manager Approvers / project Admins of that project; never your own request (the API enforces the same).
  const canReview = (item: ApprovalRequest) =>
    item.requestedBy !== user?.email &&
    item.requestedBy !== user?.name &&
    (isManager || Boolean(access?.projects.find((p) => p.name === item.projectName)?.canApprove));

  const handleReview = async (id: string, status: 'APPROVED' | 'REJECTED') => {
    setActionInProgress(id);
    try {
      const updated = await approvalApi.review(id, status);
      setApprovals((prev) => prev.map((a) => (a._id === id ? updated : a)));
      toast.success(`Request ${status === 'APPROVED' ? 'approved' : 'rejected'}`);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not review the request'));
    } finally {
      setActionInProgress(null);
    }
  };

  const filtered =
    filterStatus === 'ALL'
      ? approvals
      : approvals.filter((a) => a.status === filterStatus);
  const pager = usePagination(filtered, 10, filterStatus);

  if (isLoading) return <LoadingSpinner message="Loading Manager Approval Queue..." />;

  const pendingCount = approvals.filter((a) => a.status === 'PENDING').length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Manager Approval Queue"
        description="Governance checkpoint for sensitive cluster write operations (Pod restarts, replica scaling, production releases)"
        badge={
          pendingCount > 0 ? (
            <Badge label={`${pendingCount} Pending Approval`} variant="degraded" withPulse />
          ) : (
            <Badge label="All Clear" variant="healthy" />
          )
        }
      />

      {/* Filter Tabs */}
      <div className="flex items-center gap-1.5 border-b border-slate-200 pb-2">
        {['ALL', 'PENDING', 'APPROVED', 'REJECTED'].map((st) => (
          <button
            key={st}
            onClick={() => setFilterStatus(st)}
            className={`px-3 py-1 rounded-md text-xs font-semibold uppercase tracking-wider transition-colors ${
              filterStatus === st
                ? 'bg-sky-50 text-sky-700 border border-sky-300 font-bold'
                : 'bg-white text-slate-600 hover:text-slate-900 border border-slate-200'
            }`}
          >
            {st}
          </button>
        ))}
      </div>

      {/* Approvals Table */}
      {loadError && (
        <div className="p-3 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2" role="alert">
          <AlertTriangle size={14} /> {loadError}
        </div>
      )}
      {filtered.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck size={28} />}
          title="No approval requests in this view"
          description="Requests for pod restarts, scaling, or production deployments will appear here for DevOps Manager authorization."
        />
      ) : (
        <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="text-[11px] uppercase bg-slate-50 text-slate-600 border-b border-slate-200 font-mono font-bold">
              <tr>
                <th className="px-4 py-2.5">Project & Resource</th>
                <th className="px-4 py-2.5">Requested Action</th>
                <th className="px-4 py-2.5">Requested By</th>
                <th className="px-4 py-2.5">Reason</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5 text-right">Manager Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pager.pageItems.map((item) => (
                <tr key={item._id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-bold text-slate-900 capitalize">{item.projectName}</div>
                    <div className="font-mono text-[11px] text-sky-700">{item.resource}</div>
                  </td>

                  <td className="px-4 py-3 font-mono font-bold text-xs text-purple-700">
                    {item.action}
                  </td>

                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-800">{item.requestedBy}</div>
                    <span className="text-[10px] text-slate-500 font-mono uppercase">
                      Role: {item.requestedByRole}
                    </span>
                  </td>

                  <td className="px-4 py-3 max-w-xs text-slate-600 truncate">
                    {item.reason}
                  </td>

                  <td className="px-4 py-3">
                    <Badge
                      label={item.status}
                      variant={
                        item.status === 'APPROVED'
                          ? 'healthy'
                          : item.status === 'REJECTED'
                          ? 'offline'
                          : 'degraded'
                      }
                      withPulse={item.status === 'PENDING'}
                    />
                  </td>

                  <td className="px-4 py-3 text-right">
                    {item.status === 'PENDING' ? (
                      canReview(item) ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant="primary"
                            size="sm"
                            isLoading={actionInProgress === item._id}
                            onClick={() => handleReview(item._id, 'APPROVED')}
                            leftIcon={<CheckCircle2 size={12} />}
                          >
                            Approve
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            isLoading={actionInProgress === item._id}
                            onClick={() => handleReview(item._id, 'REJECTED')}
                            leftIcon={<XCircle size={12} />}
                          >
                            Reject
                          </Button>
                        </div>
                      ) : (
                        <span className="text-[11px] text-amber-700 font-medium flex items-center justify-end gap-1">
                          <Clock size={12} /> Awaiting Manager
                        </span>
                      )
                    ) : (
                      <span className="text-[11px] text-slate-500 font-mono">
                        {item.reviewedBy ? `Reviewed by ${item.reviewedBy}` : 'Completed'}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-slate-200 px-4 py-2.5">
            <Pagination
              page={pager.page}
              pageSize={pager.pageSize}
              total={pager.total}
              onPageChange={pager.setPage}
              onPageSizeChange={pager.setPageSize}
              itemLabel="requests"
            />
          </div>
        </div>
      )}
    </div>
  );
};
