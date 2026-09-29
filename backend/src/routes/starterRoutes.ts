import { Router } from 'express';
import { authenticate, requireManager } from '../middleware/auth.js';
import {
  createRun,
  deleteFile,
  deleteRun,
  generateRun,
  getRun,
  listRuns,
  listTargetOwners,
  listTargets,
  lookupVersion,
  publishProject,
  saveFile,
  sendMessage,
} from '../controllers/starterController.js';

// AI Project Starter: managers only.
const router = Router();
router.use(authenticate, requireManager);
router.get('/runs', listRuns);
router.post('/runs', createRun);
router.get('/runs/:id', getRun);
router.delete('/runs/:id', deleteRun);
router.post('/runs/:id/messages', sendMessage);
router.post('/runs/:id/generate', generateRun);
router.put('/runs/:id/files', saveFile);
router.delete('/runs/:id/files', deleteFile);
router.post('/runs/:id/publish', publishProject);
router.get('/targets', listTargets);
router.get('/owners', listTargetOwners);
router.get('/versions', lookupVersion);
export default router;
