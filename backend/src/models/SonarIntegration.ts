import mongoose, { Document, Schema } from 'mongoose';
import { encryptSecret, decryptSecret } from '../utils/secrets.js';

// SonarQube (or SonarCloud) server. "service" = reached through a cluster's service proxy (and analyses
// run as Jobs in that cluster); "url" = reached directly (SonarCloud, a hosted server, a port-forward).
export interface ISonarIntegration extends Document {
  name: string;
  access: 'service' | 'url';
  clusterName: string;
  namespace: string;
  service: string;
  port: number;
  url: string;
  publicUrl: string; // what a browser opens for "Open in SonarQube"
  token: string; // user token (Execute Analysis + Browse), encrypted at rest
  organization: string; // SonarCloud only
  isDefault: boolean;
  isActive: boolean;
  status: 'Connected' | 'Error' | 'Unknown';
  version: string;
  lastError: string;
  lastTestedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const SonarIntegrationSchema = new Schema<ISonarIntegration>(
  {
    name: { type: String, required: true, trim: true },
    access: { type: String, enum: ['service', 'url'], default: 'service' },
    clusterName: { type: String, default: '' },
    namespace: { type: String, default: '' },
    service: { type: String, default: '' },
    port: { type: Number, default: 0 },
    url: { type: String, default: '' },
    publicUrl: { type: String, default: '' },
    token: { type: String, default: '', set: encryptSecret, get: decryptSecret },
    organization: { type: String, default: '' },
    isDefault: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    status: { type: String, enum: ['Connected', 'Error', 'Unknown'], default: 'Unknown' },
    version: { type: String, default: '' },
    lastError: { type: String, default: '' },
    lastTestedAt: { type: Date },
  },
  { timestamps: true }
);

SonarIntegrationSchema.index({ name: 1 }, { unique: true });

export const SonarIntegration = mongoose.model<ISonarIntegration>('SonarIntegration', SonarIntegrationSchema);
