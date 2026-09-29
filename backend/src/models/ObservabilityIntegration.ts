import mongoose, { Document, Schema } from 'mongoose';
import { encryptSecret, decryptSecret } from '../utils/secrets.js';

export type ObservabilityKind = 'prometheus' | 'grafana' | 'loki';
// service: reached through the Kubernetes API server's service proxy (no port-forward needed).
// url: reached directly (ingress, port-forward, hosted service).
export type ObservabilityAccess = 'service' | 'url';
export type ObservabilityAuth = 'none' | 'basic' | 'bearer';

export interface IObservabilityIntegration extends Document {
  name: string;
  kind: ObservabilityKind;
  access: ObservabilityAccess;
  clusterName: string;
  namespace: string;
  service: string;
  port: number;
  scheme: 'http' | 'https';
  url: string;
  publicUrl: string; // what a browser opens (Grafana links)
  authType: ObservabilityAuth;
  username: string;
  password: string; // encrypted at rest
  token: string; // encrypted at rest
  insecure: boolean;
  isDefault: boolean;
  isActive: boolean;
  status: 'Connected' | 'Error' | 'Unknown';
  lastError: string;
  lastTestedAt?: Date;
  version: string;
  createdAt: Date;
  updatedAt: Date;
}

const ObservabilityIntegrationSchema = new Schema<IObservabilityIntegration>(
  {
    name: { type: String, required: true, trim: true },
    kind: { type: String, enum: ['prometheus', 'grafana', 'loki'], required: true },
    access: { type: String, enum: ['service', 'url'], default: 'service' },
    clusterName: { type: String, default: '' },
    namespace: { type: String, default: '' },
    service: { type: String, default: '' },
    port: { type: Number, default: 0 },
    scheme: { type: String, enum: ['http', 'https'], default: 'http' },
    url: { type: String, default: '' },
    publicUrl: { type: String, default: '' },
    authType: { type: String, enum: ['none', 'basic', 'bearer'], default: 'none' },
    username: { type: String, default: '' },
    password: { type: String, default: '', set: encryptSecret, get: decryptSecret },
    token: { type: String, default: '', set: encryptSecret, get: decryptSecret },
    insecure: { type: Boolean, default: false },
    isDefault: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    status: { type: String, enum: ['Connected', 'Error', 'Unknown'], default: 'Unknown' },
    lastError: { type: String, default: '' },
    lastTestedAt: { type: Date },
    version: { type: String, default: '' },
  },
  { timestamps: true }
);

ObservabilityIntegrationSchema.index({ name: 1 }, { unique: true });

export const ObservabilityIntegration = mongoose.model<IObservabilityIntegration>('ObservabilityIntegration', ObservabilityIntegrationSchema);
