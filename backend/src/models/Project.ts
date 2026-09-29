import mongoose, { Document, Schema } from 'mongoose';

export interface IGitRepoMapping {
  name: string;
  repoUrl: string;
  branch: string;
  provider?: 'gitlab' | 'github';
  /** app = source code built by CI; gitops = manifests ArgoCD deploys from. */
  role?: 'app' | 'gitops';
}

export interface IK8sMapping {
  clusterName: string;
  namespaces: string[];
}

export interface IArgoAppMapping {
  appName: string;
  targetNamespace: string;
  serverUrl?: string;
  /** Environment name shown in DevOps Intelligence (dev, qa, staging, prod…). Derived from the app name when empty. */
  environment?: string;
  /** Git branch of the app repo that deploys to this environment (branch-per-environment flow). */
  branch?: string;
  /** Deploys need an approved request. null/undefined = default (prod and production do). */
  requiresApproval?: boolean | null;
}

export interface IProject extends Document {
  name: string;
  description?: string;
  gitLabRepos: IGitRepoMapping[];
  gitopsPath?: string; // folder holding one overlay per environment, e.g. k8s/overlays
  kubernetesMappings: IK8sMapping[];
  argoApps: IArgoAppMapping[];
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ProjectSchema = new Schema<IProject>(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    description: {
      type: String,
      default: '',
    },
    gitopsPath: { type: String, default: '' },
    gitLabRepos: [
      {
        name: { type: String, required: true },
        repoUrl: { type: String, required: true },
        branch: { type: String, default: 'main' },
        provider: { type: String, enum: ['gitlab', 'github'], default: 'gitlab' },
        role: { type: String, enum: ['app', 'gitops', ''], default: '' },
      },
    ],
    kubernetesMappings: [
      {
        clusterName: { type: String, required: true, default: 'minikube' },
        namespaces: { type: [String], default: ['default'] },
      },
    ],
    argoApps: [
      {
        appName: { type: String, required: true },
        targetNamespace: { type: String, default: 'default' },
        environment: { type: String, default: '' },
        branch: { type: String, default: '' },
        requiresApproval: { type: Boolean, default: null },
        serverUrl: { type: String, default: 'https://argocd.kubeorbit.local' },
      },
    ],
    active: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

export const Project = mongoose.model<IProject>('Project', ProjectSchema);
