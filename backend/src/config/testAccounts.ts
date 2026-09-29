import { IDirectPermission, UserRole } from '../models/User.js';

// Test accounts for trying roles and permissions locally. Created by scripts/seedTestUsers.
// Only usable when ENABLE_TEST_ACCOUNTS=true and NODE_ENV is not production; their passwords are public.

export const testAccountsEnabled = () => process.env.ENABLE_TEST_ACCOUNTS === 'true' && process.env.NODE_ENV !== 'production';

type Grant = Pick<IDirectPermission, 'project' | 'environment' | 'permission'>;

export interface TestAccount {
  email: string;
  name: string;
  password: string;
  role: UserRole;
  purpose: string;
  permissions: Grant[];
  showOnLogin?: boolean;
}

const g = (project: string, environment: string, permission: IDirectPermission['permission']): Grant => ({ project, environment, permission });

export const TEST_ACCOUNTS: TestAccount[] = [
  { email: 'test.admin@devops.local', name: 'Test Admin', password: 'Admin-Test-2026', role: 'superadmin', purpose: 'Super Admin: everything', permissions: [], showOnLogin: true },
  { email: 'ops.lead@devops.local', name: 'Olivia Ops', password: 'Olivia-Test-2026', role: 'devops', purpose: 'DevOps: all projects, connectors, developer/viewer users', permissions: [] },
  {
    email: 'dev.alice@devops.local',
    name: 'Alice Developer',
    password: 'Alice-Test-2026',
    role: 'developer',
    purpose: 'Ships to dev, watches qa',
    permissions: [g('kubeorbit-demo', 'dev', 'Build and Deploy'), g('kubeorbit-demo', 'qa', 'View only')],
  },
  {
    email: 'dev.bob@devops.local',
    name: 'Bob Developer',
    password: 'Bob-Test-2026x',
    role: 'developer',
    purpose: 'Ships to dev and qa, watches staging',
    permissions: [g('kubeorbit-demo', 'dev', 'Build and Deploy'), g('kubeorbit-demo', 'qa', 'Build and Deploy'), g('kubeorbit-demo', 'staging', 'View only')],
  },
  {
    email: 'qa.carol@devops.local',
    name: 'Carol QA',
    password: 'Carol-Test-2026',
    role: 'developer',
    purpose: 'QA engineer: deploys qa and uat',
    permissions: [g('kubeorbit-demo', 'qa', 'Build and Deploy'), g('kubeorbit-demo', 'uat', 'Build and Deploy')],
  },
  {
    email: 'release.dave@devops.local',
    name: 'Dave Release',
    password: 'Dave-Test-2026',
    role: 'developer',
    purpose: 'Release engineer: deploys every kubeorbit-demo environment, incl. prod',
    permissions: [g('kubeorbit-demo', 'all', 'Build and Deploy')],
  },
  {
    email: 'lead.erin@devops.local',
    name: 'Erin Lead',
    password: 'Erin-Test-2026',
    role: 'developer',
    purpose: 'Project admin of kubeorbit-demo: edit project, add/fix/remove environments',
    permissions: [g('kubeorbit-demo', 'all', 'Admin')],
  },
  {
    email: 'mgr.frank@devops.local',
    name: 'Frank Manager',
    password: 'Frank-Test-2026',
    role: 'developer',
    purpose: 'Manager Approver for kubeorbit-demo: views everything, approves requests',
    permissions: [g('kubeorbit-demo', 'all', 'Manager Approver')],
  },
  {
    email: 'viewer.grace@devops.local',
    name: 'Grace Viewer',
    password: 'Grace-Test-2026',
    role: 'viewer',
    purpose: 'Viewer: read-only on kubeorbit-demo even though a Build and Deploy row is granted',
    permissions: [g('kubeorbit-demo', 'all', 'Build and Deploy')],
  },
  {
    email: 'dev.heidi@devops.local',
    name: 'Heidi Developer',
    password: 'Heidi-Test-2026',
    role: 'developer',
    purpose: 'Other team: granted only argo-apps (a project that does not exist), so sees no projects at all',
    permissions: [g('argo-apps', 'all', 'Build and Deploy')],
  },
];
