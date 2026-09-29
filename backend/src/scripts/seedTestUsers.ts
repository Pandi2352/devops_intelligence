// Creates or refreshes the 10 test accounts in config/testAccounts.ts (idempotent).
//   node dist/scripts/seedTestUsers.js            create / update
//   node dist/scripts/seedTestUsers.js --remove   delete them again
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { User } from '../models/User.js';
import { TEST_ACCOUNTS } from '../config/testAccounts.js';

dotenv.config();

const main = async () => {
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to seed test accounts with NODE_ENV=production.');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/kubeorbit');
  if (process.argv.includes('--remove')) {
    const r = await User.deleteMany({ isTestAccount: true });
    console.log(`Removed ${r.deletedCount} test account(s).`);
    await mongoose.disconnect();
    return;
  }
  for (const a of TEST_ACCOUNTS) {
    const user = (await User.findOne({ email: a.email })) || new User({ email: a.email });
    if (!user.isNew && !user.isTestAccount) {
      console.warn(`  skip ${a.email}: a real account with this email exists`);
      continue;
    }
    user.name = a.name;
    user.password = a.password; // hashed by the model's pre-save hook
    user.role = a.role;
    user.isSuperAdmin = a.role === 'superadmin';
    user.directPermissions = a.permissions.map((p) => ({ ...p, application: 'all' })) as typeof user.directPermissions;
    user.isActive = true;
    user.isTestAccount = true;
    user.mustChangePassword = false;
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    const created = user.isNew;
    await user.save();
    console.log(`  ${created ? 'created' : 'updated'}  ${a.email.padEnd(28)} ${a.role.padEnd(10)} ${a.purpose}`);
  }
  console.log(`${TEST_ACCOUNTS.length} test accounts ready. Passwords are in src/config/testAccounts.ts.`);
  await mongoose.disconnect();
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
