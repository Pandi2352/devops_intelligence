import crypto from 'crypto';

// JWT signing secret. Known sample values are public (they are in the repo), so anyone could forge tokens with them.
const WEAK = new Set(['', 'kubeorbit-secret', 'kubeorbit-super-secure-jwt-secret-key-2025', 'changeme', 'secret']);
let cached: string | null = null;

export const jwtSecret = (): string => {
  if (cached) return cached;
  const configured = (process.env.JWT_SECRET || '').trim();
  if (!WEAK.has(configured) && configured.length >= 32) {
    cached = configured;
    return cached;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set to a random value of at least 32 characters in production');
  }
  // Development: never sign with a public value. A per-process secret means everyone signs in again after a restart.
  cached = crypto.randomBytes(48).toString('hex');
  console.warn(
    `[Auth] JWT_SECRET is ${configured ? 'a known sample value or shorter than 32 characters' : 'not set'}; using a random secret for this run. ` +
      'Set JWT_SECRET in backend/.env (node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))") to keep sessions across restarts.'
  );
  return cached;
};

// Passwords shipped in docs and seed code: accounts still using them must change them after signing in.
export const KNOWN_DEFAULT_PASSWORDS = ['AdminPassword123!', 'DevopsPassword123!', 'DevPassword123!', 'Welcome@123'];

export const passwordProblem = (password: string): string | null => {
  if (password.length < 10) return 'Use at least 10 characters';
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) return 'Use upper-case, lower-case letters and a number';
  if (KNOWN_DEFAULT_PASSWORDS.includes(password)) return 'This password is published in the docs; pick another';
  return null;
};

// Simple in-memory throttle for failed sign-ins: 5 failures per email+IP within 15 minutes → locked for 15 minutes.
const failures = new Map<string, { count: number; first: number; lockedUntil?: number }>();
const WINDOW = 15 * 60 * 1000;

export const loginThrottle = {
  check(key: string): number {
    const f = failures.get(key);
    if (f?.lockedUntil && f.lockedUntil > Date.now()) return Math.ceil((f.lockedUntil - Date.now()) / 60000);
    return 0;
  },
  fail(key: string) {
    const now = Date.now();
    const f = failures.get(key);
    if (!f || now - f.first > WINDOW) {
      failures.set(key, { count: 1, first: now });
      return;
    }
    f.count += 1;
    if (f.count >= 5) f.lockedUntil = now + WINDOW;
  },
  success(key: string) {
    failures.delete(key);
  },
};
