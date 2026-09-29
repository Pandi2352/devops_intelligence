import mongoose, { Document, Schema } from 'mongoose';
import { encryptSecret, decryptSecret } from '../utils/secrets.js';

export type ArgoAuthType = 'token' | 'password' | 'none';

export interface IArgoIntegration extends Document {
  name: string;
  serverUrl: string;
  authType: ArgoAuthType;
  authToken?: string; // encrypted at rest
  username?: string;
  password?: string; // encrypted at rest
  insecure: boolean;
  isDefault: boolean;
  status: 'Connected' | 'Disconnected' | 'Error';
  lastError?: string;
  lastPingAt?: Date;
  version?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ArgoIntegrationSchema = new Schema<IArgoIntegration>(
  {
    name: { type: String, required: true, trim: true, default: 'Local ArgoCD' },
    serverUrl: { type: String, required: true, default: 'https://localhost:8080' },
    authType: { type: String, enum: ['token', 'password', 'none'], default: 'token' },
    authToken: { type: String, default: '', set: encryptSecret, get: decryptSecret },
    username: { type: String, default: 'admin' },
    password: { type: String, default: '', set: encryptSecret, get: decryptSecret },
    insecure: { type: Boolean, default: true },
    isDefault: { type: Boolean, default: false },
    status: { type: String, enum: ['Connected', 'Disconnected', 'Error'], default: 'Disconnected' },
    lastError: { type: String, default: '' },
    lastPingAt: { type: Date },
    version: { type: String, default: 'unknown' },
  },
  { timestamps: true }
);

export const ArgoIntegration = mongoose.model<IArgoIntegration>('ArgoIntegration', ArgoIntegrationSchema);
