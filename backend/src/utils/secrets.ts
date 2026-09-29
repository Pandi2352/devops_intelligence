import crypto from 'crypto';

// Connector credentials (PATs, bearer tokens, kubeconfigs) are encrypted at rest with AES-256-GCM.
// Values written before encryption was introduced have no prefix and are read back as plaintext.
const PREFIX = 'enc:v1:';
let cachedKey: Buffer | null = null;

const getKey = (): Buffer => {
  if (!cachedKey) {
    const secret = process.env.CREDENTIALS_SECRET || process.env.JWT_SECRET || 'kubeorbit-secret';
    if (!process.env.CREDENTIALS_SECRET) {
      console.warn(
        '[Secrets] CREDENTIALS_SECRET is not set; saved credentials are encrypted with a key derived from JWT_SECRET. ' +
          'Changing JWT_SECRET would make them unreadable: set CREDENTIALS_SECRET and migrate with dist/scripts/rotateCredentialsKey.js.'
      );
    }
    cachedKey = crypto.createHash('sha256').update(secret).digest();
  }
  return cachedKey;
};

export const encryptSecret = (value?: string): string => {
  if (!value) return '';
  if (value.startsWith(PREFIX)) return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, encrypted]).toString('base64');
};

export const decryptSecret = (value?: string): string => {
  if (!value) return '';
  if (!value.startsWith(PREFIX)) return value;
  try {
    const raw = Buffer.from(value.slice(PREFIX.length), 'base64');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const encrypted = raw.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch {
    console.error('[Secrets] Failed to decrypt a stored credential. Was CREDENTIALS_SECRET changed?');
    return '';
  }
};

// Shows only the last 4 characters so users can tell tokens apart without exposing them.
export const maskSecret = (value?: string): string => {
  if (!value) return '';
  return value.length <= 4 ? '••••' : `••••${value.slice(-4)}`;
};
