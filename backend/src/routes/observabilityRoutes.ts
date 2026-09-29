import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import {
  createObservabilityConnector,
  deleteObservabilityConnector,
  discoverObservabilityServices,
  getEvents,
  getKinds,
  getResourceDetail,
  getResources,
  getLogHistory,
  getLogs,
  getMetricsRange,
  getNamespaces,
  getPodDetail,
  getPods,
  getScopes,
  getUsage,
  listObservabilityConnectors,
  queryMetrics,
  streamLogs,
  testObservabilityConnection,
  testSavedObservabilityConnector,
  updateObservabilityConnector,
} from '../controllers/observabilityController.js';

const router = Router();
const canManage = requireRole(['superadmin', 'devops']);

router.get('/scopes', authenticate, getScopes);
router.get('/namespaces', authenticate, getNamespaces);
router.get('/pods', authenticate, getPods);
router.get('/pods/:namespace/:pod', authenticate, getPodDetail);
router.get('/events', authenticate, getEvents);
router.get('/kinds', authenticate, getKinds);
router.get('/resources', authenticate, getResources);
router.get('/resources/:kind/:namespace/:name', authenticate, getResourceDetail);

router.get('/logs', authenticate, getLogs);
router.get('/logs/stream', authenticate, streamLogs);
router.get('/logs/history', authenticate, getLogHistory);

router.get('/metrics/usage', authenticate, getUsage);
router.get('/metrics/range', authenticate, getMetricsRange);
router.get('/metrics/query', authenticate, canManage, queryMetrics);

router.get('/connectors', authenticate, listObservabilityConnectors);
router.get('/connectors/discover', authenticate, canManage, discoverObservabilityServices);
router.post('/connectors/test', authenticate, canManage, testObservabilityConnection);
router.post('/connectors', authenticate, canManage, createObservabilityConnector);
router.post('/connectors/:id/test', authenticate, canManage, testSavedObservabilityConnector);
router.put('/connectors/:id', authenticate, canManage, updateObservabilityConnector);
router.delete('/connectors/:id', authenticate, canManage, deleteObservabilityConnector);

export default router;
