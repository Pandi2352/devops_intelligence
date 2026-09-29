import { Router } from 'express';
import {
  register,
  login,
  getMe,
  changeOwnPassword,
  getTestLogin,
  getAllUsers,
  addUserWithPermissions,
  updateUserPermissions,
  deleteUser,
} from '../controllers/authController.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = Router();

router.post('/register', register);
router.post('/login', login);
router.get('/test-login', getTestLogin);
router.get('/me', authenticate, getMe);
router.post('/me/password', authenticate, changeOwnPassword);
router.get('/users', authenticate, requireRole(['superadmin', 'devops']), getAllUsers);
router.post('/users', authenticate, requireRole(['superadmin', 'devops']), addUserWithPermissions);
router.put('/users/:id', authenticate, requireRole(['superadmin', 'devops']), updateUserPermissions);
router.delete('/users/:id', authenticate, requireRole(['superadmin']), deleteUser);

export default router;
