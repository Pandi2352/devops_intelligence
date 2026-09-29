import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, CheckSquare, History, Inbox, ListChecks, RefreshCw, Search, Send } from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { Button } from '../components/common/Button';
import { Dropdown } from '../components/common/Dropdown';
import { EmptyState } from '../components/common/EmptyState';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { ConfirmDialog } from '../components/common/ConfirmDialog';
import { Pagination } from '../components/common/Pagination';
import { ScrollableTabs, TabItem } from '../components/common/ScrollableTabs';
import { ApprovalCard } from '../components/approvals/ApprovalCard';
import { ReviewDialog } from '../components/approvals/ReviewDialog';
import { AuditLogTable } from '../components/approvals/AuditLogTable';
import { STATUS_META } from '../components/approvals/approvalMeta';
import { ApprovalItem, ApprovalState, approvalApi } from '../api/approvalApi';
import { getApiErrorMessage } from '../api/client';
import { useToast } from '../context/ToastContext';
import { usePagination } from '../hooks/usePagination';

type Tab = 'waiting' | 'mine' | 'all' | 'audit';
const TAB_KEYS: Tab[] = ['waiting', 'mine', 'all', 'audit'];
const FAST_POLL_MS = 3000;
const SLOW_POLL_MS = 20000;

const EMPTY: Record<Exclude<Tab, 'audit'>, { title: string; description: string }> = {
  waiting: {
    title: 'Nothing is waiting for you',
    description:
      'When someone deploys, syncs, rolls back or merges into an environment that needs approval, the request lands here for the project’s approvers. Approving runs the action straight away.',
  },
  mine: {
    title: 'You have no requests',
    description:
      'If you trigger an action on an environment that needs approval, it is not run immediately: a request is created here and an approver is notified. You can cancel it while it is pending.',
  },
  all: {
    title: 'No approval requests yet',
    description: 'Environments marked “Deploys need approval” (production by default) turn deploy actions into requests. Project admins change this in the project’s Setup tab.',
  },
};

export const ApprovalsPage: React.FC = () => {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab: Tab = TAB_KEYS.includes(params.get('tab') as Tab) ? (params.get('tab') as Tab) : 'waiting';
  const setTab = (t: Tab) => setParams(t === 'waiting' ? {} : { tab: t }, { replace: true });

  const [items, setItems] = useState<ApprovalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [project, setProject] = useState('');
  const [status, setStatus] = useState<ApprovalState | ''>('');

  const [review, setReview] = useState<{ request: ApprovalItem; decision: 'APPROVED' | 'REJECTED' } | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<ApprovalItem | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await approvalApi.list({ status: 'all' }));
      setLoadError(null);
    } catch (err) {
      setLoadError(getApiErrorMessage(err, 'Could not load approval requests'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Follow running requests closely; otherwise refresh now and then for new requests.
  const anyExecuting = items.some((r) => r.status === 'EXECUTING' || r.status === 'APPROVED');
  useEffect(() => {
    if (tab === 'audit') return;
    const timer = window.setInterval(() => {
      if (!document.hidden) load();
    }, anyExecuting ? FAST_POLL_MS : SLOW_POLL_MS);
    return () => window.clearInterval(timer);
  }, [anyExecuting, load, tab]);

  const counts = useMemo(
    () => ({
      waiting: items.filter((r) => r.canReview && r.status === 'PENDING').length,
      mine: items.filter((r) => r.mine && r.status === 'PENDING').length,
    }),
    [items]
  );
  const projects = useMemo(() => [...new Set(items.map((r) => r.projectName).filter(Boolean))].sort(), [items]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((r) => {
      if (tab === 'waiting' && !(r.canReview && r.status === 'PENDING')) return false;
      if (tab === 'mine' && !r.mine) return false;
      if (project && r.projectName !== project) return false;
      if (status && tab !== 'waiting' && r.status !== status) return false;
      if (!needle) return true;
      return `${r.summary} ${r.action} ${r.resource} ${r.environment} ${r.reason} ${r.requestedBy} ${r.requestedByName}`.toLowerCase().includes(needle);
    });
  }, [items, tab, project, status, query]);
  const paging = usePagination(visible, 10, `${tab}|${project}|${status}|${query}`);

  const openReview = (request: ApprovalItem, decision: 'APPROVED' | 'REJECTED') => {
    setReviewError(null);
    setReview({ request, decision });
  };

  const submitReview = async (comment: string) => {
    if (!review) return;
    setReviewBusy(true);
    setReviewError(null);
    try {
      const res = await approvalApi.decide(review.request._id, review.decision, comment);
      toast.success(res.message || (review.decision === 'APPROVED' ? 'Approved — running now' : 'Request rejected'));
      setReview(null);
      await load();
    } catch (err) {
      setReviewError(getApiErrorMessage(err, 'Could not save the decision'));
      load();
    } finally {
      setReviewBusy(false);
    }
  };

  const confirmCancel = async () => {
    if (!cancelTarget) return;
    setCancelBusy(true);
    try {
      const res = await approvalApi.cancel(cancelTarget._id);
      toast.success(res.message || 'Request cancelled');
      setCancelTarget(null);
      await load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not cancel the request'));
    } finally {
      setCancelBusy(false);
    }
  };

  const badge = (n: number, tone: string) =>
    n > 0 ? <span className={`ml-1 px-1.5 rounded-full text-[10px] font-semibold ${tone}`}>{n}</span> : undefined;
  const tabs: TabItem<Tab>[] = [
    { id: 'waiting', label: 'Waiting for me', icon: <Inbox size={14} />, badge: badge(counts.waiting, 'bg-rose-600 text-white') },
    { id: 'mine', label: 'My requests', icon: <Send size={14} />, badge: badge(counts.mine, 'bg-amber-100 text-amber-900') },
    { id: 'all', label: 'All', icon: <ListChecks size={14} /> },
    { id: 'audit', label: 'Audit log', icon: <History size={14} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Approvals"
        description="Deploy actions on protected environments wait here for a second person. Approved requests run automatically, and everything is recorded in the audit log."
        actions={
          tab !== 'audit' && (
            <Button variant="secondary" size="sm" leftIcon={<RefreshCw size={13} className={anyExecuting ? 'animate-spin' : ''} />} onClick={load}>
              Refresh
            </Button>
          )
        }
      />

      <ScrollableTabs tabs={tabs} activeTab={tab} onChange={setTab} />

      {tab === 'audit' ? (
        <AuditLogTable />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[220px] max-w-sm">
              <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" aria-hidden />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by summary, environment, person or reason"
                aria-label="Search requests"
                className="w-full h-9 pl-8 pr-3 rounded-md border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500"
              />
            </div>
            <Dropdown
              ariaLabel="Project"
              value={project}
              onChange={setProject}
              options={[{ value: '', label: 'All projects' }, ...projects.map((p) => ({ value: p, label: p }))]}
              placeholder="All projects"
            />
            {tab !== 'waiting' && (
              <Dropdown<ApprovalState | ''>
                ariaLabel="Status"
                value={status}
                onChange={setStatus}
                options={[
                  { value: '', label: 'Any status' },
                  ...(Object.keys(STATUS_META) as ApprovalState[]).map((s) => ({ value: s, label: STATUS_META[s].label })),
                ]}
                placeholder="Any status"
              />
            )}
          </div>

          {loadError && (
            <div className="p-3 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2" role="alert">
              <AlertTriangle size={14} /> {loadError}
            </div>
          )}

          {loading ? (
            <LoadingSpinner />
          ) : !visible.length ? (
            items.length && (query || project || status) ? (
              <EmptyState icon={<Search size={22} />} title="No requests match" description="Clear the search or filters to see more." />
            ) : (
              <EmptyState icon={<CheckSquare size={22} />} {...EMPTY[tab]} />
            )
          ) : (
            <div className="space-y-3">
              {paging.pageItems.map((r) => (
                <ApprovalCard
                  key={r._id}
                  request={r}
                  busy={reviewBusy || cancelBusy}
                  onApprove={(x) => openReview(x, 'APPROVED')}
                  onReject={(x) => openReview(x, 'REJECTED')}
                  onCancel={setCancelTarget}
                />
              ))}
              {visible.length > paging.pageSize && (
                <Pagination page={paging.page} pageSize={paging.pageSize} total={paging.total} onPageChange={paging.setPage} onPageSizeChange={paging.setPageSize} itemLabel="requests" />
              )}
            </div>
          )}
        </>
      )}

      {review && (
        <ReviewDialog
          key={`${review.request._id}-${review.decision}`}
          request={review.request}
          decision={review.decision}
          busy={reviewBusy}
          error={reviewError}
          onSubmit={submitReview}
          onClose={() => !reviewBusy && setReview(null)}
        />
      )}

      <ConfirmDialog
        isOpen={Boolean(cancelTarget)}
        title="Cancel this request?"
        message={cancelTarget ? `“${cancelTarget.summary || cancelTarget.action}” will not run. You can trigger the action again later to create a new request.` : ''}
        confirmLabel="Cancel request"
        tone="danger"
        isLoading={cancelBusy}
        onConfirm={confirmCancel}
        onCancel={() => !cancelBusy && setCancelTarget(null)}
      />
    </div>
  );
};
