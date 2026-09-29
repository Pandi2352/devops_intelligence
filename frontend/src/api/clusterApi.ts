import api from './client';
import {
  Cluster,
  ClusterAuthType,
  ClusterType,
  ConnectionTestResult,
  K8sNode,
  K8sPod,
  K8sDeployment,
  KubeContext,
} from '../types';

export interface ClusterDetailResponse {
  cluster: Cluster;
  nodes: K8sNode[];
  pods: K8sPod[];
  deployments: K8sDeployment[];
}

export interface ClusterConnectorInput {
  name: string;
  description?: string;
  type: ClusterType;
  authType: ClusterAuthType;
  contextName?: string;
  kubeconfig?: string;
  serverUrl?: string;
  token?: string;
  caData?: string;
  insecureSkipTLSVerify?: boolean;
  isDefault?: boolean;
}

export interface ClusterSaveResponse {
  message: string;
  connector: Cluster;
  test: ConnectionTestResult;
}

export const clusterApi = {
  getAll: async (): Promise<Cluster[]> => {
    const res = await api.get('/clusters');
    return res.data.clusters;
  },
  getContexts: async (): Promise<KubeContext[]> => {
    const res = await api.get('/clusters/contexts');
    return res.data.contexts;
  },
  syncKubeconfig: async (): Promise<Cluster[]> => {
    const res = await api.post('/clusters/sync');
    return res.data.clusters;
  },
  getDetails: async (name: string): Promise<ClusterDetailResponse> => {
    const res = await api.get(`/clusters/${encodeURIComponent(name)}`);
    return res.data;
  },
  create: async (data: ClusterConnectorInput): Promise<ClusterSaveResponse> => {
    const res = await api.post('/clusters', data);
    return res.data;
  },
  update: async (id: string, data: ClusterConnectorInput): Promise<ClusterSaveResponse> => {
    const res = await api.put(`/clusters/${id}`, data);
    return res.data;
  },
  setDefault: async (id: string): Promise<Cluster> => {
    const res = await api.put(`/clusters/${id}/default`);
    return res.data.connector;
  },
  testConnection: async (data: Partial<ClusterConnectorInput> & { id?: string }): Promise<ConnectionTestResult> => {
    const res = await api.post('/clusters/test', data);
    return res.data;
  },
  testSaved: async (id: string): Promise<ConnectionTestResult & { connector: Cluster }> => {
    const res = await api.post(`/clusters/${id}/test`);
    return res.data;
  },
  delete: async (id: string, force = false): Promise<void> => {
    await api.delete(`/clusters/${id}`, { params: force ? { force: 'true' } : undefined });
  },
};
