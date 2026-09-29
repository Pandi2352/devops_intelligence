// Permission matrix for the seeded test accounts (npm run seed:test-users first).
//   API_URL=http://localhost:5000/api node dist/scripts/testPermissions.js
//
// Write checks never change anything: they send requests that pass the permission check but then fail
// input validation (400/404). So 403 = denied, anything else = allowed by permissions.
import { TEST_ACCOUNTS } from '../config/testAccounts.js';

const API = process.env.API_URL || 'http://localhost:5000/api';
const PROJECT = process.env.TEST_PROJECT_ID || '6aba360d948a2fd77c77dde1'; // kubeorbit-demo
const CONNECTOR = process.env.TEST_GITLAB_CONNECTOR || '6aba0e916479fcc86f4e8eba';
const REPO = process.env.TEST_APP_REPO || '86977729';
const OTHER_REPO = process.env.TEST_OTHER_REPO || '85848199';

type Probe = { name: string; method?: string; path: string; body?: unknown };

const call = async (token: string, p: Probe) => {
  const res = await fetch(`${API}${p.path}`, {
    method: p.method || 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: p.body ? JSON.stringify(p.body) : undefined,
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* empty */
  }
  return { status: res.status, data };
};

const allowed = (status: number) => status !== 401 && status !== 403;

// What each probe means, and which users should be allowed.
const PROBES: (Probe & { expect: string[] })[] = [
  { name: 'view kubeorbit-demo', path: `/projects/${PROJECT}/overview`, expect: ['test.admin', 'ops.lead', 'dev.alice', 'dev.bob', 'qa.carol', 'release.dave', 'lead.erin', 'mgr.frank', 'viewer.grace'] },
  { name: 'dev history', path: `/projects/${PROJECT}/environments/dev/history`, expect: ['test.admin', 'ops.lead', 'dev.alice', 'dev.bob', 'release.dave', 'lead.erin', 'mgr.frank', 'viewer.grace'] },
  { name: 'prod history', path: `/projects/${PROJECT}/environments/prod/history`, expect: ['test.admin', 'ops.lead', 'release.dave', 'lead.erin', 'mgr.frank', 'viewer.grace'] },
  { name: 'logs dev ns', path: '/observability/logs?namespace=kubeorbit-demo-dev&tailLines=1', expect: ['test.admin', 'ops.lead', 'dev.alice', 'dev.bob', 'release.dave', 'lead.erin', 'mgr.frank', 'viewer.grace'] },
  { name: 'logs uat ns', path: '/observability/logs?namespace=kubeorbit-demo-uat&tailLines=1', expect: ['test.admin', 'ops.lead', 'qa.carol', 'release.dave', 'lead.erin', 'mgr.frank', 'viewer.grace'] },
  { name: 'logs prod ns', path: '/observability/logs?namespace=kubeorbit-demo-prod&tailLines=1', expect: ['test.admin', 'ops.lead', 'release.dave', 'lead.erin', 'mgr.frank', 'viewer.grace'] },
  { name: 'pods in argocd ns', path: '/observability/pods?namespace=argocd', expect: ['test.admin', 'ops.lead'] },
  { name: 'nodes (cluster-wide)', path: '/observability/resources?kind=node', expect: ['test.admin', 'ops.lead'] },
  { name: 'promote into dev', method: 'POST', path: `/projects/${PROJECT}/environments/promote`, body: { from: 'none', to: 'dev' }, expect: ['test.admin', 'ops.lead', 'dev.alice', 'dev.bob', 'release.dave', 'lead.erin'] },
  { name: 'promote into qa', method: 'POST', path: `/projects/${PROJECT}/environments/promote`, body: { from: 'none', to: 'qa' }, expect: ['test.admin', 'ops.lead', 'dev.bob', 'qa.carol', 'release.dave', 'lead.erin'] },
  { name: 'promote into prod', method: 'POST', path: `/projects/${PROJECT}/environments/promote`, body: { from: 'none', to: 'prod' }, expect: ['test.admin', 'ops.lead', 'release.dave', 'lead.erin'] },
  { name: 'roll back uat', method: 'POST', path: `/projects/${PROJECT}/environments/uat/rollback`, body: {}, expect: ['test.admin', 'ops.lead', 'qa.carol', 'release.dave', 'lead.erin'] },
  { name: 'merge into qa', method: 'POST', path: `/git/${CONNECTOR}/repos/${REPO}/merge-requests`, body: { source: 'qa', target: 'qa' }, expect: ['test.admin', 'ops.lead', 'dev.bob', 'qa.carol', 'release.dave', 'lead.erin'] },
  { name: 'merge into prod', method: 'POST', path: `/git/${CONNECTOR}/repos/${REPO}/merge-requests`, body: { source: 'prod', target: 'prod' }, expect: ['test.admin', 'ops.lead', 'release.dave', 'lead.erin'] },
  { name: 'pipelines of app repo', path: `/git/${CONNECTOR}/repos/${REPO}/pipelines`, expect: ['test.admin', 'ops.lead', 'dev.alice', 'dev.bob', 'qa.carol', 'release.dave', 'lead.erin', 'mgr.frank', 'viewer.grace'] },
  { name: 'pipelines of unrelated repo', path: `/git/${CONNECTOR}/repos/${OTHER_REPO}/pipelines`, expect: ['test.admin', 'ops.lead'] },
  { name: 'add environment', method: 'POST', path: `/projects/${PROJECT}/environments/add`, body: { name: 'NOT VALID' }, expect: ['test.admin', 'ops.lead', 'lead.erin'] },
  { name: 'edit project', method: 'PUT', path: `/projects/${PROJECT}`, body: { name: 'rename-is-refused' }, expect: ['test.admin', 'ops.lead', 'lead.erin'] },
  { name: 'create project', method: 'POST', path: '/projects', body: { name: '--' }, expect: ['test.admin', 'ops.lead'] },
  { name: 'list users', path: '/auth/users', expect: ['test.admin', 'ops.lead'] },
  { name: 'create connector', method: 'POST', path: '/observability/connectors', body: {}, expect: ['test.admin', 'ops.lead'] },
  { name: 'list DNS connectors', path: '/dns/connectors', expect: ['test.admin', 'ops.lead'] },
  { name: 'create DNS connector', method: 'POST', path: '/dns/connectors', body: {}, expect: ['test.admin', 'ops.lead'] },
  { name: 'project DNS status', path: `/projects/${PROJECT}/dns?probe=0`, expect: ['test.admin', 'ops.lead', 'dev.alice', 'dev.bob', 'qa.carol', 'release.dave', 'lead.erin', 'mgr.frank', 'viewer.grace'] },
  { name: 'set prod hostname', method: 'PUT', path: `/projects/${PROJECT}/environments/prod/dns`, body: { hostname: 'not valid' }, expect: ['test.admin', 'ops.lead', 'lead.erin'] },
  { name: 'apply prod DNS', method: 'POST', path: `/projects/${PROJECT}/environments/prod/dns/apply`, body: { reason: 'permission test' }, expect: ['test.admin', 'ops.lead', 'release.dave', 'lead.erin'] },
  { name: 'stop dev preview', method: 'DELETE', path: `/projects/${PROJECT}/environments/dev/preview`, expect: ['test.admin', 'ops.lead', 'dev.alice', 'dev.bob', 'release.dave', 'lead.erin'] },
  { name: 'public URLs page', path: '/dns/public-urls?probe=0', expect: ['test.admin', 'ops.lead', 'dev.alice', 'dev.bob', 'qa.carol', 'release.dave', 'lead.erin', 'mgr.frank', 'viewer.grace', 'dev.heidi'] },
  { name: 'list tunnels', path: '/dns/tunnels?live=0', expect: ['test.admin', 'ops.lead'] },
  { name: 'PromQL explorer', path: '/observability/metrics/query?query=up', expect: ['test.admin', 'ops.lead'] },
  { name: 'view prod ArgoCD app', path: '/argocd/apps/kubeorbit-demo-api-prod', expect: ['test.admin', 'ops.lead', 'release.dave', 'lead.erin', 'mgr.frank', 'viewer.grace'] },
];

// Visible environments of kubeorbit-demo per user (projects overview).
const VISIBLE: Record<string, string[]> = {
  'test.admin': ['dev', 'qa', 'staging', 'uat', 'prod'],
  'ops.lead': ['dev', 'qa', 'staging', 'uat', 'prod'],
  'dev.alice': ['dev', 'qa'],
  'dev.bob': ['dev', 'qa', 'staging'],
  'qa.carol': ['qa', 'uat'],
  'release.dave': ['dev', 'qa', 'staging', 'uat', 'prod'],
  'lead.erin': ['dev', 'qa', 'staging', 'uat', 'prod'],
  'mgr.frank': ['dev', 'qa', 'staging', 'uat', 'prod'],
  'viewer.grace': ['dev', 'qa', 'staging', 'uat', 'prod'],
  'dev.heidi': [],
};

const main = async () => {
  let pass = 0;
  const failures: string[] = [];
  const tokens: Record<string, string> = {};
  const check = (label: string, ok: boolean, detail = '') => {
    if (ok) pass += 1;
    else failures.push(`${label}${detail ? ` (${detail})` : ''}`);
  };

  for (const a of TEST_ACCOUNTS) {
    const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: a.email, password: a.password }) });
    const d: any = await r.json();
    check(`${a.email} signs in`, r.ok && Boolean(d.token), `HTTP ${r.status} ${d.message || ''}`);
    tokens[a.email.split('@')[0]] = d.token;
  }

  // Header row
  const users = Object.keys(tokens);
  const short = (u: string) => u.split('.')[1] || u;
  console.log(`\n${'probe'.padEnd(28)}${users.map((u) => short(u).padEnd(7)).join('')}`);
  for (const probe of PROBES) {
    let row = probe.name.padEnd(28);
    for (const u of users) {
      const { status } = await call(tokens[u], probe);
      const want = probe.expect.includes(u);
      const got = allowed(status);
      check(`${u}: ${probe.name}`, want === got, `expected ${want ? 'allowed' : 'denied'}, got HTTP ${status}`);
      row += `${got ? (want ? ' ok ' : ' !! ') : want ? ' !! ' : ' -- '}${String(status).padEnd(3)}`.padEnd(7);
    }
    console.log(row);
  }

  console.log('\nvisible kubeorbit-demo environments');
  for (const u of users) {
    const { data } = await call(tokens[u], { name: 'overview', path: '/projects/overview' });
    const demo = (data?.projects || []).find((p: any) => p.name === 'kubeorbit-demo');
    const envs = (demo?.environments || []).map((e: any) => e.name).sort();
    const want = [...(VISIBLE[u] || [])].sort();
    check(`${u}: visible envs`, JSON.stringify(envs) === JSON.stringify(want), `got ${envs.join(',') || 'none'}, expected ${want.join(',') || 'none'}`);
    const projects = (data?.projects || []).map((p: any) => p.name).sort();
    console.log(`  ${u.padEnd(14)} projects: ${projects.join(', ') || '—'}  | kubeorbit-demo envs: ${envs.join(', ') || '—'}`);
  }

  // Approvals: alice asks, frank (Manager Approver) approves; alice and bob cannot.
  const created = await call(tokens['dev.alice'], {
    name: 'create approval',
    method: 'POST',
    path: '/approvals',
    body: { projectName: 'kubeorbit-demo', action: 'PROD_DEPLOY', resource: 'kubeorbit-demo-api-prod', reason: 'permission test' },
  });
  const id = created.data?.request?._id;
  check('request records the real requester', created.data?.request?.requestedBy === 'dev.alice@devops.local', created.data?.request?.requestedBy);
  check('alice creates an approval request', created.status === 201 && Boolean(id), `HTTP ${created.status}`);
  if (id) {
    const review = (u: string) => call(tokens[u], { name: 'review', method: 'PUT', path: `/approvals/${id}/review`, body: { status: 'APPROVED', reviewComment: 'test' } });
    check('alice cannot approve her own request', (await review('dev.alice')).status === 403);
    check('bob (no approver right) cannot approve', (await review('dev.bob')).status === 403);
    check('heidi (other project) cannot approve', (await review('dev.heidi')).status === 403);
    check('frank (Manager Approver) approves', (await review('mgr.frank')).status === 200);
    const own = await call(tokens['mgr.frank'], { name: 'frank asks', method: 'POST', path: '/approvals', body: { projectName: 'kubeorbit-demo', action: 'PROD_DEPLOY', resource: 'x', reason: 'self-approval test', requestedBy: 'someone.else@devops.local' } });
    check('requester cannot be spoofed from the body', own.data?.request?.requestedBy === 'mgr.frank@devops.local', own.data?.request?.requestedBy);
    const ownId = own.data?.request?._id;
    if (ownId) check('frank cannot approve his own request', (await call(tokens['mgr.frank'], { name: 'self', method: 'PUT', path: `/approvals/${ownId}/review`, body: { status: 'APPROVED' } })).status === 403);
    const listFor = async (u: string) => ((await call(tokens[u], { name: 'list', path: '/approvals' })).data?.approvals || []).some((a: any) => a._id === id);
    check('heidi does not see the request', !(await listFor('dev.heidi')));
    check('alice sees her own request', await listFor('dev.alice'));
  }

  // Probes into approval-gated environments (prod) and the approval checks created requests: cancel them.
  const pending = await call(tokens['test.admin'], { name: 'pending', path: '/approvals?status=PENDING' });
  for (const r of pending.data?.approvals || []) {
    if (String(r.summary || '').startsWith('Promote none') || /permission test|self-approval test/.test(String(r.reason || ''))) {
      await call(tokens['test.admin'], { name: 'cancel', method: 'POST', path: `/approvals/${r._id}/cancel` });
    }
  }

  console.log(`\nRESULT: ${pass} passed, ${failures.length} failed`);
  failures.forEach((f) => console.log(`  FAIL ${f}`));
  process.exit(failures.length ? 1 : 0);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
