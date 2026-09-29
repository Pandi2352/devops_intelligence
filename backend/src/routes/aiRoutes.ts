import { Router } from 'express';
import { authenticate, requireManager } from '../middleware/auth.js';
import {
  createAiConnector,
  deleteAiConnector,
  listAiConnectors,
  setDefaultAiConnector,
  testAiConnection,
  testSavedAiConnector,
  updateAiConnector,
} from '../controllers/aiController.js';

// AI provider connectors hold paid API keys: DevOps admins only.
const router = Router();
router.get('/connectors', authenticate, requireManager, listAiConnectors);
router.post('/connectors/test', authenticate, requireManager, testAiConnection);
router.post('/connectors', authenticate, requireManager, createAiConnector);
router.post('/connectors/:id/test', authenticate, requireManager, testSavedAiConnector);
router.put('/connectors/:id/default', authenticate, requireManager, setDefaultAiConnector);
router.put('/connectors/:id', authenticate, requireManager, updateAiConnector);
router.delete('/connectors/:id', authenticate, requireManager, deleteAiConnector);
export default router;
