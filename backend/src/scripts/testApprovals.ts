// End-to-end check of the approval flow with the seeded test accounts, on the dev environment
// (temporarily switched to "requires approval", then restored). The only action it really runs is an ArgoCD sync of dev.
//   node dist/scripts/testApprovals.js
const API = process.env.API_URL || 'http://localhost:5000/api';
const PROJECT = process.env.TEST_PROJECT_ID || '6aba360d948a2fd77c77dde1';
const DEV_APP = 'kubeorbit-demo-api-dev';

const login = async (email: string, password: string) => {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  return ((await r.json()) as any).token as string;
};
const call = async (token: string, method: string, path: string, body?: unknown) => {
  const r = await fetch(`${API}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  let data: any = null;
  try {
    data = await r.json();
  } catch {
    /* empty */
  }
  return { status: r.status, data };
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const main = async () => {
  let pass = 0;
  const fails: string[] = [];
  const check = (label: string, ok: boolean, detail = '') => (ok ? (pass += 1) : fails.push(`${label}${detail ? ` (${detail})` : ''}`));

  const admin = await login('test.admin@devops.local', 'Admin-Test-2026');
  const alice = await login('dev.alice@devops.local', 'Alice-Test-2026');
  const bob = await login('dev.bob@devops.local', 'Bob-Test-2026x');
  const frank = await login('mgr.frank@devops.local', 'Frank-Test-2026');
  const erin = await login('lead.erin@devops.local', 'Erin-Test-2026');

  // Only project admins switch the setting.
  check('alice cannot change the approval setting', (await call(alice, 'PUT', `/projects/${PROJECT}/environments/dev/approval`, { requiresApproval: true })).status === 403);
  const on = await call(erin, 'PUT', `/projects/${PROJECT}/environments/dev/approval`, { requiresApproval: true });
  check('erin (project admin) turns approval on for dev', on.status === 200 && on.data?.requiresApproval === true, on.data?.message);

  try {
    const env = await call(alice, 'GET', `/projects/${PROJECT}/environments`);
    check('environments API reports dev as gated', env.data?.environments?.find((e: any) => e.key === 'dev')?.requiresApproval === true);

    // 1. alice asks to sync dev → request instead of action
    const asked = await call(alice, 'POST', `/argocd/apps/${DEV_APP}/sync`, { reason: 'approval flow test' });
    check('alice sync of dev returns 202 approvalRequired', asked.status === 202 && asked.data?.approvalRequired === true, `HTTP ${asked.status}`);
    const id = asked.data?.request?._id;
    const again = await call(alice, 'POST', `/argocd/apps/${DEV_APP}/sync`, {});
    check('asking twice reuses the pending request', again.status === 202 && again.data?.request?._id === id);
    check('request carries context for approvers', Boolean(asked.data?.request?.context?.app) && Boolean(asked.data?.request?.summary), JSON.stringify(asked.data?.request?.context));

    const envWait = await call(alice, 'GET', `/projects/${PROJECT}/environments`);
    check('dev shows the pending approval', envWait.data?.environments?.find((e: any) => e.key === 'dev')?.pendingApproval?.id === id);
    const summary = await call(frank, 'GET', '/approvals/summary');
    check('frank sees it waiting for him', summary.data?.waitingForMe >= 1, JSON.stringify(summary.data));

    // 2. who may review
    check('alice cannot approve her own request', (await call(alice, 'PUT', `/approvals/${id}/review`, { status: 'APPROVED' })).status === 403);
    check('bob (no approver right) cannot approve', (await call(bob, 'PUT', `/approvals/${id}/review`, { status: 'APPROVED' })).status === 403);

    // 3. frank approves → DevOps Intelligence runs the sync as alice
    const approved = await call(frank, 'PUT', `/approvals/${id}/review`, { status: 'APPROVED', reviewComment: 'looks good' });
    check('frank approves', approved.status === 200, approved.data?.message);
    let final: any = null;
    for (let i = 0; i < 40; i += 1) {
      const list = await call(frank, 'GET', '/approvals?status=all');
      final = list.data?.approvals?.find((a: any) => a._id === id);
      if (final && ['EXECUTED', 'FAILED'].includes(final.status)) break;
      await sleep(1500);
    }
    check('the approved sync ran', final?.status === 'EXECUTED', `${final?.status}: ${final?.execution?.message}`);
    check('reviewing twice is refused', (await call(frank, 'PUT', `/approvals/${id}/review`, { status: 'APPROVED' })).status === 409);

    // 4. reject and cancel paths
    const r2 = (await call(alice, 'POST', `/projects/${PROJECT}/environments/dev/redeploy`, { reason: 'reject test' })).data?.request?._id;
    const rejected = await call(frank, 'PUT', `/approvals/${r2}/review`, { status: 'REJECTED', reviewComment: 'not now' });
    check('frank rejects a redeploy request', rejected.status === 200 && rejected.data?.request?.status === 'REJECTED');
    const r3 = (await call(alice, 'POST', `/projects/${PROJECT}/environments/dev/rollback`, { sha: 'deadbeef' })).data?.request?._id;
    check('bob cannot cancel alice’s request', (await call(bob, 'POST', `/approvals/${r3}/cancel`)).status === 403);
    check('alice cancels her own request', (await call(alice, 'POST', `/approvals/${r3}/cancel`)).status === 200);

    // 5. Super Admin break-glass: self-approval needs a real comment
    const r4 = (await call(admin, 'POST', `/projects/${PROJECT}/environments/dev/rollback`, {})).data?.request?._id;
    check('super admin self-approval without comment is refused', (await call(admin, 'PUT', `/approvals/${r4}/review`, { status: 'APPROVED' })).status === 400);
    await call(admin, 'POST', `/approvals/${r4}/cancel`);

    // 6. audit trail
    const auditLog = await call(frank, 'GET', `/approvals/audit?project=kubeorbit-demo&environment=dev`);
    const outcomes = new Set((auditLog.data?.events || []).filter((e: any) => [id, r2, r3].includes(e.requestId)).map((e: any) => e.outcome));
    check('audit has requested/approved/succeeded/rejected/cancelled', ['requested', 'approved', 'succeeded', 'rejected', 'cancelled'].every((o) => outcomes.has(o)), [...outcomes].join(','));
    const heidi = await login('dev.heidi@devops.local', 'Heidi-Test-2026');
    const hidden = await call(heidi, 'GET', '/approvals/audit?project=kubeorbit-demo');
    check('heidi sees no kubeorbit-demo audit events', (hidden.data?.events || []).length === 0);
  } finally {
    const off = await call(erin, 'PUT', `/projects/${PROJECT}/environments/dev/approval`, { requiresApproval: null });
    check('dev approval setting restored to default (off)', off.data?.requiresApproval === false && off.data?.isDefault === true, off.data?.message);
  }

  // prod stays gated by default, and a non-gated deploy in dev is audited as a direct action
  const prod = await call(alice, 'GET', `/projects/${PROJECT}/environments`);
  check('alice does not see prod', !prod.data?.environments?.some((e: any) => e.key === 'prod'));
  const dave = await login('release.dave@devops.local', 'Dave-Test-2026');
  const daveEnv = await call(dave, 'GET', `/projects/${PROJECT}/environments`);
  check('prod requires approval by default', daveEnv.data?.environments?.find((e: any) => e.key === 'prod')?.requiresApproval === true);

  console.log(`RESULT: ${pass} passed, ${fails.length} failed`);
  fails.forEach((f) => console.log(`  FAIL ${f}`));
  process.exit(fails.length ? 1 : 0);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
