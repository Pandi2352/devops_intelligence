import mongoose, { Document, Schema } from 'mongoose';
import { encryptSecret, decryptSecret } from '../utils/secrets.js';

export type GitProvider = 'github' | 'gitlab';
export type ConnectorStatus = 'Connected' | 'Error' | 'Unknown';

export interface IGitIntegration extends Document {
  name: string;
  provider: GitProvider;
  baseUrl?: string; // For GitLab self-hosted, default 'https://gitlab.com'
  token: string; // Personal access token, encrypted at rest (getter returns plaintext)
  username?: string;
  organizations: string[];
  isActive: boolean;
  isDefault: boolean;
  status: ConnectorStatus;
  lastError?: string;
  lastTestedAt?: Date;
  lastConnectedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const GitIntegrationSchema = new Schema<IGitIntegration>(
  {
    name: { type: String, required: true, trim: true },
    provider: { type: String, enum: ['github', 'gitlab'], required: true },
    baseUrl: { type: String, default: '' },
    token: { type: String, required: true, set: encryptSecret, get: decryptSecret },
    username: { type: String, default: '' },
    organizations: { type: [String], default: [] },
    isActive: { type: Boolean, default: true },
    isDefault: { type: Boolean, default: false },
    status: { type: String, enum: ['Connected', 'Error', 'Unknown'], default: 'Unknown' },
    lastError: { type: String, default: '' },
    lastTestedAt: { type: Date },
    lastConnectedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export const GitIntegration = mongoose.model<IGitIntegration>('GitIntegration', GitIntegrationSchema);
