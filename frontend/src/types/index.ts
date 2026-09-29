export type UserRole = 'superadmin' | 'devops' | 'developer' | 'viewer';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  allowedClusters: string[];
  allowedEnvironments: string[];
  isActive?: boolean;
  createdAt?: string;
  lastLogin?: string;
}

export type ClusterStatus = 'Healthy' | 'Degraded' | 'Offline' | 'Connecting';
export type ClusterType = 'minikube' | 'local' | 'eks' | 'gke' | 'aks' | 'baremetal';

export type ClusterAuthType = 'context' | 'kubeconfig' | 'token';

export interface Cluster {
  _id?: string;
  name: string;
  description?: string;
  contextName: string;
  type: ClusterType;
  authType?: ClusterAuthType;
  source?: 'kubeconfig' | 'manual';
  serverUrl: string;
  version: string;
  nodeCount: number;
  status: ClusterStatus;
  isDefault: boolean;
  namespaces: string[];
  lastSyncedAt?: string;
  lastTestedAt?: string;
  lastError?: string;
  insecureSkipTLSVerify?: boolean;
  hasKubeconfig?: boolean;
  tokenHint?: string;
  hasCaData?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface KubeContext {
  name: string;
  cluster: string;
  user: string;
  isCurrent: boolean;
  server?: string;
}

export interface K8sNode {
  name: string;
  status: string;
  kubeletVersion: string;
  osImage: string;
  architecture: string;
  cpu?: string;
  memory?: string;
}

export interface K8sPod {
  name: string;
  namespace: string;
  status: string;
  podIP?: string;
  startTime?: string;
  restartCount: number;
}

export interface K8sDeployment {
  name: string;
  namespace: string;
  replicas?: number;
  readyReplicas?: number;
  strategy?: string;
}

export type ConnectorStatus = 'Connected' | 'Error' | 'Unknown';

export interface GitIntegration {
  _id: string;
  name: string;
  provider: 'github' | 'gitlab';
  baseUrl?: string;
  username?: string;
  organizations?: string[];
  isActive: boolean;
  isDefault?: boolean;
  status?: ConnectorStatus;
  lastError?: string;
  lastTestedAt?: string;
  lastConnectedAt?: string;
  tokenHint?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface GitRepo {
  id: number | string;
  name: string;
  fullName: string;
  private: boolean;
  htmlUrl: string;
  cloneUrl: string;
  sshUrl?: string;
  defaultBranch: string;
  description?: string;
  lastActivityAt?: string;
  createdAt?: string;
  starCount?: number;
  forksCount?: number;
}

export interface GitCommit {
  id: string;
  shortId: string;
  title: string;
  message?: string;
  authorName: string;
  authorEmail: string;
  committedDate: string;
  webUrl: string;
}

export interface GitBranchInfo {
  name: string;
  default: boolean;
  protected: boolean;
  webUrl?: string;
  commit?: {
    id: string;
    shortId: string;
    title: string;
  };
}

export interface PipelineStage {
  id?: number | string;
  name: string;
  stage?: string;
  status: 'success' | 'running' | 'failed' | 'pending' | 'skipped' | 'created' | 'canceled';
  tool?: string;
  duration?: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  error?: string;
  webUrl?: string;
  failureReason?: string;
}

export interface PipelineRun {
  id: number;
  status: 'success' | 'running' | 'failed' | 'pending' | 'created' | 'canceled' | string;
  ref: string;
  sha: string;
  commitTitle: string;
  author: string;
  triggeredBy?: string;
  source?: string;
  tests?: { total: number; passed: number; failed: number; skipped: number } | null;
  createdAt: string;
  duration?: string;
  webUrl: string;
  stages: PipelineStage[];
}

export type ArgoAuthType = 'token' | 'password' | 'none';

export interface ArgoIntegration {
  id?: string;
  _id?: string;
  name: string;
  serverUrl: string;
  authType?: ArgoAuthType;
  username?: string;
  hasToken?: boolean;
  tokenHint?: string;
  hasPassword?: boolean;
  insecure?: boolean;
  isDefault?: boolean;
  status: 'Connected' | 'Disconnected' | 'Error';
  version?: string;
  lastPingAt?: string;
  lastError?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
  details?: Record<string, string | number>;
}

export interface ArgoApplication {
  metadata?: {
    name: string;
    namespace?: string;
  };
  status?: {
    sync?: {
      status: string;
    };
    health?: {
      status: string;
    };
  };
}

export type ApprovalAction = 'RESTART_POD' | 'SCALE_DEPLOYMENT' | 'PROD_DEPLOY' | 'ROLLBACK';
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface ApprovalRequest {
  _id: string;
  projectName: string;
  action: ApprovalAction;
  resource: string;
  details?: string;
  reason: string;
  requestedBy: string;
  requestedByRole: string;
  status: ApprovalStatus;
  reviewedBy?: string;
  reviewComment?: string;
  createdAt?: string;
  reviewedAt?: string;
}

