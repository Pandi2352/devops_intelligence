// Re-encrypts every stored connector credential from one key to another.
//
//   OLD_CREDENTIALS_SECRET=<old> NEW_CREDENTIALS_SECRET=<new> node dist/scripts/rotateCredentialsKey.js [--apply]
//
// Without --apply it only reports what would change. Values that are not encrypted (legacy plaintext) are encrypted.
// Values the old key cannot open are reported and left untouched.
import crypto from 'crypto';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const PREFIX = 'enc:v1:';
const keyOf = (secret: string) => crypto.createHash('sha256').update(secret).digest();

const decrypt = (value: string, key: Buffer): string | null => {
  if (!value) return '';
  if (!value.startsWith(PREFIX)) return value;
  try {
    const raw = Buffer.from(value.slice(PREFIX.length), 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
  } catch {
    return null;
  }
};

const encrypt = (value: string, key: Buffer): string => {
  if (!value) return '';
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(value, 'utf8'), c.final()]);
  return PREFIX + Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
};

const FIELDS: Record<string, string[]> = {
  argointegrations: ['authToken', 'password'],
  clusters: ['kubeconfig', 'token'],
  gitintegrations: ['token'],
  observabilityintegrations: ['password', 'token'],
};

const main = async () => {
  const oldSecret = process.env.OLD_CREDENTIALS_SECRET;
  const newSecret = process.env.NEW_CREDENTIALS_SECRET;
  if (!oldSecret || !newSecret || newSecret.length < 32) {
    console.error('Set OLD_CREDENTIALS_SECRET and NEW_CREDENTIALS_SECRET (at least 32 characters).');
    process.exit(1);
  }
  const apply = process.argv.includes('--apply');
  const oldKey = keyOf(oldSecret);
  const newKey = keyOf(newSecret);
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/kubeorbit');
  const db = mongoose.connection.db!;
  let changed = 0;
  let unreadable = 0;
  for (const [collection, fields] of Object.entries(FIELDS)) {
    const docs = await db.collection(collection).find({}).toArray();
    for (const doc of docs) {
      const update: Record<string, string> = {};
      for (const f of fields) {
        const value = doc[f];
        if (!value) continue;
        const plain = decrypt(String(value), oldKey);
        if (plain === null) {
          if (decrypt(String(value), newKey) !== null) continue; // already on the new key
          unreadable += 1;
          console.warn(`  cannot decrypt ${collection}.${f} of ${doc.name || doc._id} with the old key: re-enter it in Connectors`);
          continue;
        }
        update[f] = encrypt(plain, newKey);
      }
      if (Object.keys(update).length) {
        changed += Object.keys(update).length;
        console.log(`  ${apply ? 're-encrypted' : 'would re-encrypt'} ${collection} ${doc.name || doc._id}: ${Object.keys(update).join(', ')}`);
        if (apply) await db.collection(collection).updateOne({ _id: doc._id }, { $set: update });
      }
    }
  }
  console.log(`${apply ? 'Done' : 'Dry run'}: ${changed} value(s) ${apply ? 're-encrypted' : 'to re-encrypt'}, ${unreadable} unreadable.`);
  await mongoose.disconnect();
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
