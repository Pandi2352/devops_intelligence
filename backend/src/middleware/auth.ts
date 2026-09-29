import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { User, IUser, UserRole } from '../models/User.js';
import { IProject, Project } from '../models/Project.js';
import { jwtSecret } from '../utils/authSecrets.js';
import { LEVEL_NAME, Level, envLevel, isManager, namespaceLevel, projectLevel } from '../services/access.js';
import { isValidId } from '../utils/validation.js';
import { testAccountsEnabled } from '../config/testAccounts.js';

export interface AuthRequest extends Request {
  user?: IUser;
  project?: IProject;
}

export interface TokenPayload {
  id: string;
  tv: number; // token version
}

export const signToken = (user: IUser): string =>
  jwt.sign({ id: String(user._id), tv: user.tokenVersion || 0 } satisfies TokenPayload, jwtSecret(), {
    expiresIn: (process.env.JWT_EXPIRES_IN || '12h') as jwt.SignOptions['expiresIn'],
  });

// Resolves a bearer token to an active user, or null. Used by HTTP routes and the Socket.io handshake.
export const userFromToken = async (token: string | undefined): Promise<IUser | null> => {
  if (!token) return null;
  let payload: TokenPayload;
  try {
    payload = jwt.verify(token, jwtSecret()) as TokenPayload;
  } catch {
    return null;
  }
  if (!isValidId(payload.id)) return null;
  const user = await User.findById(payload.id).select('-password');
  if (!user || !user.isActive) return null;
  if ((user.tokenVersion || 0) !== (payload.tv || 0)) return null; // password, role or status changed since sign-in
  if (user.isTestAccount && !testAccountsEnabled()) return null;
  return user;
};

// Every protected route: a valid, current token for an active user. No fallbacks.
export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) {
      res.status(401).json({ message: 'Sign in required', code: 'NO_TOKEN' });
      return;
    }
    const user = await userFromToken(token);
    if (!user) {
      res.status(401).json({ message: 'Your session has expired. Sign in again.', code: 'INVALID_TOKEN' });
      return;
    }
    req.user = user;
    next();
  } catch {
    res.status(401).json({ message: 'Could not verify your session', code: 'AUTH_ERROR' });
  }
};

export const requireRole = (allowedRoles: UserRole[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ message: 'Sign in required' });
      return;
    }
    const role: UserRole = req.user.isSuperAdmin ? 'superadmin' : req.user.role;
    if (!allowedRoles.includes(role) && role !== 'superadmin') {
      res.status(403).json({ message: `Your role (${req.user.role}) cannot do this. Needed: ${allowedRoles.join(' or ')}.` });
      return;
    }
    next();
  };
};

// Super Admin or DevOps.
export const requireManager = requireRole(['superadmin', 'devops']);

const forbid = (res: Response, needed: Level, what: string) =>
  res.status(403).json({ message: `You need ${LEVEL_NAME[needed]} access to ${what}. Ask a DevOps admin to grant it in Authorization → User Permissions.` });

// Project routes (/projects/:id/...): loads the project and checks the level on the project, or on one environment
// when envOf returns a name (e.g. req.params.env, req.body.to).
export const requireProject = (needed: Level, envOf?: (req: AuthRequest) => string | undefined) => {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const project = isValidId(req.params.id) ? await Project.findById(req.params.id) : null;
    if (!project) {
      res.status(404).json({ message: 'Project not found' });
      return;
    }
    const env = envOf?.(req);
    const level = env ? envLevel(req.user, project.name, env) : projectLevel(req.user, project.name);
    if (level < needed) {
      forbid(res, needed, env ? `${project.name} · ${env}` : `project ${project.name}`);
      return;
    }
    req.project = project;
    next();
  };
};

// Namespaced observability routes: the namespace must belong to an environment the user can see.
// "all" is allowed and filtered by the handler.
export const requireNamespace = (needed: Level, nsOf: (req: AuthRequest) => unknown) => {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    if (isManager(req.user)) return next();
    const ns = String(nsOf(req) || 'all');
    if (ns === 'all') return next();
    if ((await namespaceLevel(req.user, ns)) < needed) {
      forbid(res, needed, `namespace ${ns}`);
      return;
    }
    next();
  };
};

