import { Router } from 'express';
import {
  listApprovals,
  createApprovalRequest,
  reviewApprovalRequest,
} from '../controllers/approvalController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.get('/', authenticate, listApprovals);
router.post('/', authenticate, createApprovalRequest);
router.put('/:id/review', authenticate, reviewApprovalRequest);

export default router;
