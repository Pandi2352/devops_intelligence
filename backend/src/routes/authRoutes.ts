import { Router } from 'express';
import {
  register,
  login,
  getMe,
  getAllUsers,
  addUserWithPermissions,
  updateUserPermissions,
  deleteUser,
} from '../controllers/authController.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = Router();

router.post('/register', register);
router.post('/login', login);
router.get('/me', authenticate, getMe);
router.get('/users', authenticate, getAllUsers);
router.post('/users', authenticate, requireRole(['superadmin', 'devops']), addUserWithPermissions);
router.put('/users/:id', authenticate, requireRole(['superadmin', 'devops']), updateUserPermissions);
router.delete('/users/:id', authenticate, requireRole(['superadmin']), deleteUser);

export default router;
