import { Router } from 'express';
import {
  getArgoStatus,
  updateArgoConfig,
  listArgoApplications,
  syncArgoApplication,
  listArgoConnectors,
  createArgoConnector,
  updateArgoConnector,
  setDefaultArgoConnector,
  deleteArgoConnector,
  testArgoConnection,
  testSavedArgoConnector,
} from '../controllers/argoController.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import {
  listApps,
  getApp,
  getAppTree,
  getAppDiff,
  getAppEvents,
  refreshApp,
  syncApp,
  rollbackApp,
  terminateOperation,
} from '../controllers/argoAppsController.js';

const router = Router();
const canManageConnectors = requireRole(['superadmin', 'devops']);

router.get('/status', authenticate, getArgoStatus);
router.post('/config', authenticate, canManageConnectors, updateArgoConfig);
router.get('/applications', authenticate, listArgoApplications);
router.post('/applications/:name/sync', authenticate, canManageConnectors, syncArgoApplication);

router.get('/connectors', authenticate, listArgoConnectors);
router.post('/connectors', authenticate, canManageConnectors, createArgoConnector);
router.post('/connectors/test', authenticate, canManageConnectors, testArgoConnection);
router.put('/connectors/:id', authenticate, canManageConnectors, updateArgoConnector);
router.put('/connectors/:id/default', authenticate, canManageConnectors, setDefaultArgoConnector);
router.delete('/connectors/:id', authenticate, canManageConnectors, deleteArgoConnector);
router.post('/connectors/:id/test', authenticate, canManageConnectors, testSavedArgoConnector);

// Application explorer
router.get('/apps', authenticate, listApps);
router.get('/apps/:name', authenticate, getApp);
router.get('/apps/:name/tree', authenticate, getAppTree);
router.get('/apps/:name/diff', authenticate, getAppDiff);
router.get('/apps/:name/events', authenticate, getAppEvents);
router.post('/apps/:name/refresh', authenticate, refreshApp);
router.post('/apps/:name/sync', authenticate, canManageConnectors, syncApp);
router.post('/apps/:name/rollback', authenticate, canManageConnectors, rollbackApp);
router.delete('/apps/:name/operation', authenticate, canManageConnectors, terminateOperation);

export default router;
