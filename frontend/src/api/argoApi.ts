import api from './client';
import { ArgoApplication, ArgoAuthType, ArgoIntegration, ConnectionTestResult } from '../types';

export interface ArgoConnectorInput {
  name: string;
  serverUrl: string;
  authType: ArgoAuthType;
  authToken?: string;
  username?: string;
  password?: string;
  insecure: boolean;
  isDefault?: boolean;
}

export interface ArgoSaveResponse {
  message: string;
  connector: ArgoIntegration;
  test: ConnectionTestResult;
}

export const argoApi = {
  getStatus: async (): Promise<ArgoIntegration> => {
    const res = await api.get('/argocd/status');
    return res.data.integration;
  },
  updateConfig: async (data: {
    serverUrl: string;
    authToken?: string;
    username?: string;
    password?: string;
  }): Promise<ArgoIntegration> => {
    const res = await api.post('/argocd/config', data);
    return res.data.integration;
  },
  getApplications: async (): Promise<ArgoApplication[]> => {
    const res = await api.get('/argocd/applications');
    return res.data.applications;
  },
  syncApp: async (name: string): Promise<any> => {
    const res = await api.post(`/argocd/applications/${encodeURIComponent(name)}/sync`);
    return res.data;
  },

  getConnectors: async (): Promise<ArgoIntegration[]> => {
    const res = await api.get('/argocd/connectors');
    return res.data.connectors;
  },
  createConnector: async (data: ArgoConnectorInput): Promise<ArgoSaveResponse> => {
    const res = await api.post('/argocd/connectors', data);
    return res.data;
  },
  updateConnector: async (id: string, data: ArgoConnectorInput): Promise<ArgoSaveResponse> => {
    const res = await api.put(`/argocd/connectors/${id}`, data);
    return res.data;
  },
  setDefaultConnector: async (id: string): Promise<ArgoIntegration> => {
    const res = await api.put(`/argocd/connectors/${id}/default`);
    return res.data.connector;
  },
  deleteConnector: async (id: string): Promise<void> => {
    await api.delete(`/argocd/connectors/${id}`);
  },
  testConnection: async (data: Partial<ArgoConnectorInput> & { id?: string }): Promise<ConnectionTestResult> => {
    const res = await api.post('/argocd/connectors/test', data);
    return res.data;
  },
  testSaved: async (id: string): Promise<ConnectionTestResult & { connector: ArgoIntegration }> => {
    const res = await api.post(`/argocd/connectors/${id}/test`);
    return res.data;
  },
};
