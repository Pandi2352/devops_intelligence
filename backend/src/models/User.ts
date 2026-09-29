import mongoose, { Document, Schema } from 'mongoose';
import bcrypt from 'bcryptjs';

export type UserRole = 'superadmin' | 'devops' | 'developer' | 'viewer';

export interface IDirectPermission {
  project: string; // project name or '*'
  environment: string; // 'all' | 'dev' | 'staging' | 'prod'
  application: string; // 'all' | application name
  permission: 'View only' | 'Build and Deploy' | 'Admin' | 'Manager Approver';
}

export interface IK8sResourcePermission {
  cluster: string;
  namespace: string;
  apiGroup: string;
  kind: string;
  resourceName: string;
  role: 'View' | 'Admin' | 'Edit';
}

export interface IUser extends Document {
  name: string;
  email: string;
  password: string;
  role: UserRole;
  isSuperAdmin?: boolean;
  allowedClusters: string[]; // cluster names or '*' for all
  allowedEnvironments: string[]; // ['dev', 'staging', 'prod']
  directPermissions: IDirectPermission[];
  k8sResourcePermissions: IK8sResourcePermission[];
  isActive: boolean;
  lastLogin?: Date;
  tokenVersion: number; // bumped on password/role/active changes: older tokens stop working
  mustChangePassword: boolean;
  isTestAccount: boolean; // seeded by scripts/seedTestUsers; sign-in only when ENABLE_TEST_ACCOUNTS=true
  passwordChangedAt?: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
}

const UserSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: 6 },
    role: {
      type: String,
      enum: ['superadmin', 'devops', 'developer', 'viewer'],
      default: 'developer',
    },
    isSuperAdmin: { type: Boolean, default: false },
    allowedClusters: { type: [String], default: ['*'] },
    allowedEnvironments: { type: [String], default: ['dev', 'staging'] },
    directPermissions: [
      {
        project: { type: String, required: true, default: '*' },
        environment: { type: String, default: 'all' },
        application: { type: String, default: 'all' },
        permission: {
          type: String,
          enum: ['View only', 'Build and Deploy', 'Admin', 'Manager Approver'],
          default: 'View only',
        },
      },
    ],
    k8sResourcePermissions: [
      {
        cluster: { type: String, default: 'default_cluster' },
        namespace: { type: String, default: 'All Namespaces / Cluster scoped' },
        apiGroup: { type: String, default: 'All API groups' },
        kind: { type: String, default: 'All kind' },
        resourceName: { type: String, default: 'All resources' },
        role: { type: String, enum: ['View', 'Admin', 'Edit'], default: 'View' },
      },
    ],
    isActive: { type: Boolean, default: true },
    lastLogin: { type: Date },
    tokenVersion: { type: Number, default: 0 },
    mustChangePassword: { type: Boolean, default: false },
    isTestAccount: { type: Boolean, default: false },
    passwordChangedAt: { type: Date },
  },
  { timestamps: true }
);

// Hash password before saving
UserSchema.pre<IUser>('save', async function (next) {
  if (!this.isModified('password')) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err: any) {
    next(err);
  }
});

UserSchema.methods.comparePassword = async function (candidatePassword: string): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password);
};

export const User = mongoose.model<IUser>('User', UserSchema);
