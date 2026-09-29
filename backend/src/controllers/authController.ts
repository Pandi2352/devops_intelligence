import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { User, IUser, UserRole } from '../models/User.js';
import { AuthRequest } from '../middleware/auth.js';

const generateToken = (userId: string): string => {
  const secret = process.env.JWT_SECRET || 'kubeorbit-secret';
  const expiresIn = process.env.JWT_EXPIRES_IN || '7d';
  return jwt.sign({ id: userId }, secret, { expiresIn: expiresIn as any });
};

// Seed initial superadmin if database is empty
export const seedAdminIfNone = async (): Promise<void> => {
  try {
    const count = await User.countDocuments();
    if (count === 0) {
      const defaultAdmin = new User({
        name: 'DevOps Administrator',
        email: 'admin@kubeorbit.local',
        password: 'AdminPassword123!',
        role: 'superadmin',
        allowedClusters: ['*'],
        allowedEnvironments: ['dev', 'staging', 'prod'],
      });
      await defaultAdmin.save();
      console.log('[Auth] Default superadmin user initialized: admin@kubeorbit.local / AdminPassword123!');
    }
  } catch (err) {
    console.error('[Auth] Error seeding admin user:', err);
  }
};

export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, password, role, allowedClusters, allowedEnvironments } = req.body;
    
    const existing = await User.findOne({ email });
    if (existing) {
      res.status(400).json({ message: 'User with this email already exists' });
      return;
    }

    const user = new User({
      name,
      email,
      password,
      role: role || 'developer',
      allowedClusters: allowedClusters || ['*'],
      allowedEnvironments: allowedEnvironments || ['dev'],
    });

    await user.save();
    const token = generateToken(user._id.toString());

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        allowedClusters: user.allowedClusters,
        allowedEnvironments: user.allowedEnvironments,
      },
    });
  } catch (err: any) {
    res.status(500).json({ message: 'Registration failed', error: err.message });
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ message: 'Email and password are required' });
      return;
    }

    const user = await User.findOne({ email });
    if (!user) {
      res.status(401).json({ message: 'Invalid email or password' });
      return;
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      res.status(401).json({ message: 'Invalid email or password' });
      return;
    }

    user.lastLogin = new Date();
    await user.save();

    const token = generateToken(user._id.toString());
    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        allowedClusters: user.allowedClusters,
        allowedEnvironments: user.allowedEnvironments,
      },
    });
  } catch (err: any) {
    res.status(500).json({ message: 'Login failed', error: err.message });
  }
};

export const getMe = async (req: AuthRequest, res: Response): Promise<void> => {
  res.json({ user: req.user });
};

export const getAllUsers = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json({ users });
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to fetch users', error: err.message });
  }
};

export const addUserWithPermissions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      email,
      name,
      password,
      role,
      isSuperAdmin,
      directPermissions,
      k8sResourcePermissions,
    } = req.body;

    if (!email) {
      res.status(400).json({ message: 'Email address is required' });
      return;
    }

    const cleanEmail = email.trim().toLowerCase();
    const existing = await User.findOne({ email: cleanEmail });
    if (existing) {
      res.status(400).json({ message: `User '${cleanEmail}' already exists` });
      return;
    }

    const userName = name || cleanEmail.split('@')[0];
    const userPassword = password || 'Welcome@123';

    const newUser = new User({
      name: userName,
      email: cleanEmail,
      password: userPassword,
      role: isSuperAdmin ? 'superadmin' : role || 'developer',
      isSuperAdmin: Boolean(isSuperAdmin),
      directPermissions: directPermissions || [],
      k8sResourcePermissions: k8sResourcePermissions || [],
      allowedClusters: ['*'],
      allowedEnvironments: ['dev', 'staging', 'prod'],
      isActive: true,
    });

    await newUser.save();

    res.status(201).json({
      message: 'User created successfully with assigned project permissions',
      user: {
        id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        isSuperAdmin: newUser.isSuperAdmin,
        directPermissions: newUser.directPermissions,
        k8sResourcePermissions: newUser.k8sResourcePermissions,
        createdAt: (newUser as any).createdAt,
      },
    });
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to create user', error: err.message });
  }
};

export const deleteUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const deleted = await User.findByIdAndDelete(id);
    if (!deleted) {
      res.status(404).json({ message: 'User not found' });
      return;
    }
    res.json({ message: `User ${deleted.email} deleted successfully` });
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to delete user', error: err.message });
  }
};

export const updateUserPermissions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { isSuperAdmin, role, directPermissions, k8sResourcePermissions } = req.body;

    const user = await User.findById(id);
    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    if (isSuperAdmin !== undefined) {
      user.isSuperAdmin = isSuperAdmin;
      if (isSuperAdmin) user.role = 'superadmin';
    }
    if (role) user.role = role;
    if (directPermissions) user.directPermissions = directPermissions;
    if (k8sResourcePermissions) user.k8sResourcePermissions = k8sResourcePermissions;

    await user.save();
    res.json({ message: 'User permissions updated successfully', user });
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to update user permissions', error: err.message });
  }
};

