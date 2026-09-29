import { Router } from 'express';
import {
  approvalSummary,
  cancelApprovalRequest,
  createApprovalRequest,
  listApprovals,
  listAuditEvents,
  reviewApprovalRequest,
} from '../controllers/approvalController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.get('/', authenticate, listApprovals);
router.get('/summary', authenticate, approvalSummary);
router.get('/audit', authenticate, listAuditEvents);
router.post('/', authenticate, createApprovalRequest);
router.put('/:id/review', authenticate, reviewApprovalRequest);
router.post('/:id/cancel', authenticate, cancelApprovalRequest);

export default router;
