import mongoose, { Document, Schema } from 'mongoose';
import { encryptSecret, decryptSecret } from '../utils/secrets.js';

export type DnsProvider = 'cloudflare';

export interface IDnsIntegration extends Document {
  name: string;
  provider: DnsProvider;
  apiToken: string; // encrypted at rest
  accountId: string; // needed for account-owned tokens (and Cloudflare Tunnel later)
  zones: string[]; // zone names this connector may use; empty = every zone the token can see
  isDefault: boolean;
  isActive: boolean;
  status: 'Connected' | 'Limited' | 'Error' | 'Unknown'; // Limited = sees zones, but not everything DNS needs
  lastError: string;
  lastTestedAt?: Date;
  tokenStatus: string; // active / disabled / expired, as Cloudflare reports it
  tokenExpiresOn?: Date;
  zoneCount: number;
  dnsReadable: boolean;
  capabilities: { zoneRead: boolean; dnsRead: boolean; settingsRead: boolean; tunnelRead: boolean | null } | null;
  createdAt: Date;
  updatedAt: Date;
}

const DnsIntegrationSchema = new Schema<IDnsIntegration>(
  {
    name: { type: String, required: true, trim: true },
    provider: { type: String, enum: ['cloudflare'], default: 'cloudflare' },
    apiToken: { type: String, default: '', set: encryptSecret, get: decryptSecret },
    accountId: { type: String, default: '' },
    zones: { type: [String], default: [] },
    isDefault: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    status: { type: String, enum: ['Connected', 'Limited', 'Error', 'Unknown'], default: 'Unknown' },
    lastError: { type: String, default: '' },
    lastTestedAt: { type: Date },
    tokenStatus: { type: String, default: '' },
    tokenExpiresOn: { type: Date },
    zoneCount: { type: Number, default: 0 },
    dnsReadable: { type: Boolean, default: false },
    capabilities: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

DnsIntegrationSchema.index({ name: 1 }, { unique: true });

export const DnsIntegration = mongoose.model<IDnsIntegration>('DnsIntegration', DnsIntegrationSchema);
