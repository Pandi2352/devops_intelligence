import mongoose, { Document, Schema } from 'mongoose';
import { encryptSecret, decryptSecret } from '../utils/secrets.js';

// A Cloudflare Tunnel (remotely managed) and the cloudflared Deployment that runs it in one cluster.
export interface ICloudflareTunnel extends Document {
  name: string;
  connectorId: string;
  tunnelId: string;
  clusterName: string;
  namespace: string;
  token: string; // cloudflared connector token, encrypted at rest
  replicas: number;
  deployed: boolean;
  status: string; // Cloudflare: inactive / degraded / healthy / down
  connections: number;
  lastError: string;
  lastCheckedAt?: Date;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const CloudflareTunnelSchema = new Schema<ICloudflareTunnel>(
  {
    name: { type: String, required: true, trim: true },
    connectorId: { type: String, required: true },
    tunnelId: { type: String, required: true },
    clusterName: { type: String, required: true },
    namespace: { type: String, default: 'cloudflared' },
    token: { type: String, default: '', set: encryptSecret, get: decryptSecret },
    replicas: { type: Number, default: 1 },
    deployed: { type: Boolean, default: false },
    status: { type: String, default: 'inactive' },
    connections: { type: Number, default: 0 },
    lastError: { type: String, default: '' },
    lastCheckedAt: { type: Date },
    createdBy: { type: String, default: '' },
  },
  { timestamps: true }
);

CloudflareTunnelSchema.index({ tunnelId: 1 }, { unique: true });
CloudflareTunnelSchema.index({ name: 1 }, { unique: true });

export const CloudflareTunnel = mongoose.model<ICloudflareTunnel>('CloudflareTunnel', CloudflareTunnelSchema);
