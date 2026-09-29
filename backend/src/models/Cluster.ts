import mongoose, { Document, Schema } from 'mongoose';
import { encryptSecret, decryptSecret } from '../utils/secrets.js';

export type ClusterStatus = 'Healthy' | 'Degraded' | 'Offline' | 'Connecting';
export type ClusterType = 'minikube' | 'local' | 'eks' | 'gke' | 'aks' | 'baremetal';
// context: a context from the server's local kubeconfig
// kubeconfig: a kubeconfig document pasted/uploaded by the user
// token: API server URL + bearer token (e.g. a ServiceAccount token)
export type ClusterAuthType = 'context' | 'kubeconfig' | 'token';

export interface ICluster extends Document {
  name: string;
  description?: string;
  contextName: string;
  type: ClusterType;
  authType: ClusterAuthType;
  source: 'kubeconfig' | 'manual';
  serverUrl: string;
  version?: string;
  nodeCount: number;
  status: ClusterStatus;
  isDefault: boolean;
  namespaces: string[];
  lastSyncedAt?: Date;
  lastTestedAt?: Date;
  lastError?: string;
  kubeconfig?: string; // encrypted at rest
  token?: string; // encrypted at rest
  caData?: string;
  insecureSkipTLSVerify: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ClusterSchema = new Schema<ICluster>(
  {
    name: { type: String, required: true, unique: true, trim: true },
    description: { type: String, default: '' },
    contextName: { type: String, default: '' },
    type: {
      type: String,
      enum: ['minikube', 'local', 'eks', 'gke', 'aks', 'baremetal'],
      default: 'minikube',
    },
    authType: { type: String, enum: ['context', 'kubeconfig', 'token'], default: 'context' },
    source: { type: String, enum: ['kubeconfig', 'manual'], default: 'manual' },
    serverUrl: { type: String, default: '' },
    version: { type: String, default: 'unknown' },
    nodeCount: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['Healthy', 'Degraded', 'Offline', 'Connecting'],
      default: 'Connecting',
    },
    isDefault: { type: Boolean, default: false },
    namespaces: { type: [String], default: [] },
    lastSyncedAt: { type: Date, default: Date.now },
    lastTestedAt: { type: Date },
    lastError: { type: String, default: '' },
    kubeconfig: { type: String, default: '', set: encryptSecret, get: decryptSecret },
    token: { type: String, default: '', set: encryptSecret, get: decryptSecret },
    caData: { type: String, default: '' },
    insecureSkipTLSVerify: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const Cluster = mongoose.model<ICluster>('Cluster', ClusterSchema);
