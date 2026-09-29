import mongoose, { Document, Schema } from 'mongoose';
import { encryptSecret, decryptSecret } from '../utils/secrets.js';

// An AI provider account. v1: OpenAI (ChatGPT API); "openai-compatible" covers any service with the same API.
export type AiProvider = 'openai' | 'openai-compatible';

export interface IAiConnector extends Document {
  name: string;
  provider: AiProvider;
  baseUrl: string; // https://api.openai.com/v1
  apiKey: string; // encrypted at rest
  organization: string; // optional OpenAI-Organization header
  project: string; // optional OpenAI-Project header
  defaultModel: string;
  models: string[]; // from the last successful Test
  maxOutputTokens: number;
  isDefault: boolean;
  isActive: boolean;
  status: 'Connected' | 'Error' | 'Unknown';
  lastError: string;
  lastTestedAt?: Date;
  usage: { promptTokens: number; completionTokens: number; requests: number };
  createdAt: Date;
  updatedAt: Date;
}

const AiConnectorSchema = new Schema<IAiConnector>(
  {
    name: { type: String, required: true, trim: true },
    provider: { type: String, enum: ['openai', 'openai-compatible'], default: 'openai' },
    baseUrl: { type: String, default: 'https://api.openai.com/v1' },
    apiKey: { type: String, default: '', set: encryptSecret, get: decryptSecret },
    organization: { type: String, default: '' },
    project: { type: String, default: '' },
    defaultModel: { type: String, default: '' },
    models: { type: [String], default: [] },
    maxOutputTokens: { type: Number, default: 16000 },
    isDefault: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    status: { type: String, enum: ['Connected', 'Error', 'Unknown'], default: 'Unknown' },
    lastError: { type: String, default: '' },
    lastTestedAt: { type: Date },
    usage: {
      promptTokens: { type: Number, default: 0 },
      completionTokens: { type: Number, default: 0 },
      requests: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

AiConnectorSchema.index({ name: 1 }, { unique: true });

export const AiConnector = mongoose.model<IAiConnector>('AiConnector', AiConnectorSchema);
