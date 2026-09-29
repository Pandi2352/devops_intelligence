import { Request, Response } from 'express';
import crypto from 'crypto';
import { User, IUser, UserRole } from '../models/User.js';
import { AuthRequest, signToken } from '../middleware/auth.js';
import { KNOWN_DEFAULT_PASSWORDS, loginThrottle, passwordProblem } from '../utils/authSecrets.js';
import { accessSummary, isSuperAdmin } from '../services/access.js';
import { cleanString, isValidId } from '../utils/validation.js';

const ROLES: UserRole[] = ['superadmin', 'devops', 'developer', 'viewer'];
const PERMISSIONS = ['View only', 'Build and Deploy', 'Admin', 'Manager Approver'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const publicUser = (u: IUser) => ({
  id: String(u._id),
  _id: String(u._id), // older screens use _id
  isSuperAdmin: Boolean(u.isSuperAdmin || u.role === 'superadmin'),
  name: u.name,
  email: u.email,
  role: u.isSuperAdmin ? 'superadmin' : u.role,
  isActive: u.isActive,
  mustChangePassword: Boolean(u.mustChangePassword),
  directPermissions: u.directPermissions || [],
  allowedClusters: u.allowedClusters,
  allowedEnvironments: u.allowedEnvironments,
  lastLogin: u.lastLogin,
  createdAt: (u as any).createdAt,
});

const tempPassword = () => `Tmp-${crypto.randomBytes(9).toString('base64url')}9a`;

// Seeds the first superadmin on an empty database. Its published password must be changed at first sign-in.
export const seedAdminIfNone = async (): Promise<void> => {
  try {
    if ((await User.countDocuments()) > 0) return;
    const password = process.env.ADMIN_INITIAL_PASSWORD || 'AdminPassword123!';
    await new User({
      name: 'DevOps Administrator',
      email: 'admin@kubeorbit.local',
      password,
      role: 'superadmin',
      isSuperAdmin: true,
      allowedClusters: ['*'],
      allowedEnvironments: ['dev', 'staging', 'prod'],
      mustChangePassword: true,
    }).save();
    console.log('[Auth] Created the first superadmin admin@kubeorbit.local. Change its password at first sign-in.');
  } catch (err) {
    console.error('[Auth] Error seeding admin user:', err);
  }
};

// Self sign-up is off: users are added by an admin in Authorization → User Permissions.
// ALLOW_SIGNUP=true enables it, always as a Viewer with no project access.
export const register = async (req: Request, res: Response): Promise<void> => {
  if (process.env.ALLOW_SIGNUP !== 'true') {
    res.status(403).json({ message: 'Self sign-up is disabled. Ask a DevOps admin to create your account.' });
    return;
  }
  try {
    const email = cleanString(req.body?.email, 200).toLowerCase();
    const name = cleanString(req.body?.name, 100) || email.split('@')[0];
    const password = String(req.body?.password || '');
    if (!EMAIL.test(email)) {
      res.status(400).json({ message: 'Enter a valid email address' });
      return;
    }
    const problem = passwordProblem(password);
    if (problem) {
      res.status(400).json({ message: problem });
      return;
    }
    if (await User.exists({ email })) {
      res.status(409).json({ message: 'An account with this email already exists' });
      return;
    }
    const user = await new User({ name, email, password, role: 'viewer', directPermissions: [], allowedEnvironments: [] }).save();
    res.status(201).json({ message: 'Account created with viewer access. An admin grants project access.', token: signToken(user), user: publicUser(user) });
  } catch (err: any) {
    res.status(500).json({ message: 'Registration failed', error: err.message });
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const email = cleanString(req.body?.email, 200).toLowerCase();
    const password = String(req.body?.password || '');
    if (!email || !password) {
      res.status(400).json({ message: 'Email and password are required' });
      return;
    }
    const key = `${email}|${req.ip}`;
    const lockedFor = loginThrottle.check(key);
    if (lockedFor) {
      res.status(429).json({ message: `Too many failed attempts. Try again in ${lockedFor} minute${lockedFor === 1 ? '' : 's'}.` });
      return;
    }

    const user = await User.findOne({ email });
    // Same message for unknown email and wrong password, so accounts cannot be enumerated.
    if (!user || !(await user.comparePassword(password))) {
      loginThrottle.fail(key);
      res.status(401).json({ message: 'Invalid email or password' });
      return;
    }
    if (!user.isActive) {
      res.status(403).json({ message: 'This account is disabled. Contact a DevOps admin.' });
      return;
    }
    loginThrottle.success(key);
    user.lastLogin = new Date();
    if (KNOWN_DEFAULT_PASSWORDS.includes(password)) user.mustChangePassword = true;
    await user.save();
    res.json({ token: signToken(user), user: publicUser(user), access: await accessSummary(user) });
  } catch (err: any) {
    res.status(500).json({ message: 'Login failed', error: err.message });
  }
};

export const getMe = async (req: AuthRequest, res: Response): Promise<void> => {
  res.json({ user: publicUser(req.user!), access: await accessSummary(req.user!) });
};

// Change your own password; returns a fresh token because older ones stop working.
export const changeOwnPassword = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await User.findById(req.user!._id);
    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }
    const current = String(req.body?.currentPassword || '');
    const next = String(req.body?.newPassword || '');
    if (!(await user.comparePassword(current))) {
      res.status(400).json({ message: 'Current password is wrong' });
      return;
    }
    const problem = passwordProblem(next);
    if (problem || next === current) {
      res.status(400).json({ message: problem || 'Pick a password different from the current one' });
      return;
    }
    user.password = next;
    user.mustChangePassword = false;
    user.passwordChangedAt = new Date();
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();
    res.json({ message: 'Password changed. Other sessions were signed out.', token: signToken(user), user: publicUser(user) });
  } catch (err: any) {
    res.status(500).json({ message: 'Could not change the password', error: err.message });
  }
};

export const getAllUsers = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json({ users: users.map(publicUser) });
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to fetch users', error: err.message });
  }
};

const cleanPermissions = (list: unknown) =>
  (Array.isArray(list) ? list : [])
    .map((p: any) => ({
      project: cleanString(p?.project, 60) || '*',
      environment: cleanString(p?.environment, 30) || 'all',
      application: cleanString(p?.application, 60) || 'all',
      permission: PERMISSIONS.includes(p?.permission) ? p.permission : 'View only',
    }))
    .slice(0, 100);

// DevOps admins manage developers and viewers; only a Super Admin creates or changes admins.
const roleChangeAllowed = (actor: IUser, targetRole: UserRole) => isSuperAdmin(actor) || targetRole === 'developer' || targetRole === 'viewer';

export const addUserWithPermissions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const email = cleanString(req.body?.email, 200).toLowerCase();
    if (!EMAIL.test(email)) {
      res.status(400).json({ message: 'Enter a valid email address' });
      return;
    }
    const role: UserRole = req.body?.isSuperAdmin ? 'superadmin' : ROLES.includes(req.body?.role) ? req.body.role : 'developer';
    if (!roleChangeAllowed(req.user!, role)) {
      res.status(403).json({ message: 'Only a Super Admin can create Super Admin or DevOps accounts' });
      return;
    }
    if (await User.exists({ email })) {
      res.status(409).json({ message: `User '${email}' already exists` });
      return;
    }
    let password = String(req.body?.password || '');
    let generated = false;
    if (!password) {
      password = tempPassword();
      generated = true;
    } else {
      const problem = passwordProblem(password);
      if (problem) {
        res.status(400).json({ message: problem });
        return;
      }
    }
    const user = await new User({
      name: cleanString(req.body?.name, 100) || email.split('@')[0],
      email,
      password,
      role,
      isSuperAdmin: role === 'superadmin',
      directPermissions: cleanPermissions(req.body?.directPermissions),
      k8sResourcePermissions: Array.isArray(req.body?.k8sResourcePermissions) ? req.body.k8sResourcePermissions.slice(0, 50) : [],
      allowedClusters: ['*'],
      allowedEnvironments: [],
      isActive: true,
      mustChangePassword: true, // whoever set it knows it; the user picks their own at first sign-in
    }).save();
    res.status(201).json({
      message: generated ? 'User created. Share the temporary password below once; it must be changed at first sign-in.' : 'User created. They must change the password at first sign-in.',
      temporaryPassword: generated ? password : undefined,
      user: publicUser(user),
    });
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to create user', error: err.message });
  }
};

export const updateUserPermissions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = isValidId(req.params.id) ? await User.findById(req.params.id) : null;
    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }
    const actor = req.user!;
    const currentRole: UserRole = user.isSuperAdmin ? 'superadmin' : user.role;
    if (!roleChangeAllowed(actor, currentRole)) {
      res.status(403).json({ message: 'Only a Super Admin can change Super Admin or DevOps accounts' });
      return;
    }
    const nextRole: UserRole | undefined = req.body?.isSuperAdmin === true ? 'superadmin' : ROLES.includes(req.body?.role) ? req.body.role : undefined;
    if (nextRole && !roleChangeAllowed(actor, nextRole)) {
      res.status(403).json({ message: 'Only a Super Admin can grant Super Admin or DevOps roles' });
      return;
    }
    const self = String(user._id) === String(actor._id);
    if (self && ((nextRole && nextRole !== currentRole) || req.body?.isActive === false)) {
      res.status(400).json({ message: 'You cannot change your own role or disable your own account' });
      return;
    }

    let revoke = false;
    if (nextRole && nextRole !== currentRole) {
      if (currentRole === 'superadmin' && (await User.countDocuments({ $or: [{ role: 'superadmin' }, { isSuperAdmin: true }], isActive: true })) <= 1) {
        res.status(400).json({ message: 'Keep at least one active Super Admin' });
        return;
      }
      user.role = nextRole;
      user.isSuperAdmin = nextRole === 'superadmin';
      revoke = true;
    } else if (req.body?.isSuperAdmin === false && user.isSuperAdmin) {
      user.isSuperAdmin = false;
      revoke = true;
    }
    if (req.body?.directPermissions !== undefined) user.directPermissions = cleanPermissions(req.body.directPermissions) as IUser['directPermissions'];
    if (Array.isArray(req.body?.k8sResourcePermissions)) user.k8sResourcePermissions = req.body.k8sResourcePermissions.slice(0, 50);
    if (typeof req.body?.isActive === 'boolean' && req.body.isActive !== user.isActive) {
      user.isActive = req.body.isActive;
      revoke = true;
    }
    if (typeof req.body?.name === 'string' && req.body.name.trim()) user.name = cleanString(req.body.name, 100);

    let temporaryPassword: string | undefined;
    if (req.body?.resetPassword === true) {
      temporaryPassword = tempPassword();
      user.password = temporaryPassword;
      user.mustChangePassword = true;
      revoke = true;
    }
    if (revoke) user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();
    res.json({
      message: temporaryPassword ? 'Password reset. Share the temporary password once; it must be changed at next sign-in.' : 'User updated',
      temporaryPassword,
      user: publicUser(user),
    });
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to update user', error: err.message });
  }
};

export const deleteUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = isValidId(req.params.id) ? await User.findById(req.params.id) : null;
    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }
    if (String(user._id) === String(req.user!._id)) {
      res.status(400).json({ message: 'You cannot delete your own account' });
      return;
    }
    if ((user.isSuperAdmin || user.role === 'superadmin') && (await User.countDocuments({ $or: [{ role: 'superadmin' }, { isSuperAdmin: true }] })) <= 1) {
      res.status(400).json({ message: 'Keep at least one Super Admin' });
      return;
    }
    await user.deleteOne();
    res.json({ message: `User ${user.email} deleted` });
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to delete user', error: err.message });
  }
};
