import mongoose, { Document, Schema } from 'mongoose';

// One "new project" conversation in the AI Project Starter: chat → plan → files → repository.

export type StarterStatus = 'chatting' | 'generating' | 'ready' | 'publishing' | 'published' | 'failed';
export type StepState = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export interface StarterMessage {
  role: 'user' | 'assistant';
  content: string;
  at: Date;
  versions?: { ecosystem: string; name: string; latest: string; found: boolean; notes?: string }[];
}

export interface StarterStep {
  key: 'interview' | 'plan' | 'files' | 'review' | 'create-repo' | 'upload' | 'commit';
  label: string;
  state: StepState;
  message: string;
  startedAt?: Date;
  finishedAt?: Date;
}

export interface StarterPlan {
  name: string;
  summary: string;
  stack: { name: string; ecosystem: string; version: string; purpose: string }[];
  files: { path: string; purpose: string }[];
  setupInstructions: string;
}

export interface IStarterRun extends Document {
  owner: string; // email
  ownerName: string;
  title: string;
  connectorId: string;
  aiModel: string;
  status: StarterStatus;
  messages: StarterMessage[];
  plan: StarterPlan | null;
  files: { path: string; content: string }[];
  steps: StarterStep[];
  repo: { connectorId: string; provider: string; owner: string; name: string; visibility: string; url: string; fullName: string; branch: string; commit: string } | null;
  usage: { promptTokens: number; completionTokens: number; requests: number };
  error: string;
  createdAt: Date;
  updatedAt: Date;
}

export const initialSteps = (): StarterStep[] => [
  { key: 'interview', label: 'Requirements', state: 'running', message: '' },
  { key: 'plan', label: 'Plan & versions', state: 'pending', message: '' },
  { key: 'files', label: 'Generate files', state: 'pending', message: '' },
  { key: 'review', label: 'Review', state: 'pending', message: '' },
  { key: 'create-repo', label: 'Create repository', state: 'pending', message: '' },
  { key: 'upload', label: 'Upload files', state: 'pending', message: '' },
  { key: 'commit', label: 'Commit & push', state: 'pending', message: '' },
];

const StarterRunSchema = new Schema<IStarterRun>(
  {
    owner: { type: String, required: true, index: true },
    ownerName: { type: String, default: '' },
    title: { type: String, default: 'New project' },
    connectorId: { type: String, default: '' },
    aiModel: { type: String, default: '' },
    status: { type: String, enum: ['chatting', 'generating', 'ready', 'publishing', 'published', 'failed'], default: 'chatting' },
    messages: { type: Schema.Types.Mixed, default: [] }, // whole array stored as-is (markModified on change)
    plan: { type: Schema.Types.Mixed, default: null },
    files: { type: [{ path: String, content: String, _id: false }], default: [] },
    steps: { type: Schema.Types.Mixed, default: initialSteps },
    repo: { type: Schema.Types.Mixed, default: null },
    usage: {
      promptTokens: { type: Number, default: 0 },
      completionTokens: { type: Number, default: 0 },
      requests: { type: Number, default: 0 },
    },
    error: { type: String, default: '' },
  },
  { timestamps: true }
);

export const StarterRun = mongoose.model<IStarterRun>('StarterRun', StarterRunSchema);
