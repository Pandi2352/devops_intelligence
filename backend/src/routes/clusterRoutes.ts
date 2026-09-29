import { Router } from 'express';
import {
  getAllClusters,
  getClusterDetails,
  getDiscoveredContexts,
  syncClustersFromKubeConfig,
  createClusterCredential,
  updateCluster,
  setDefaultCluster,
  testClusterConnection,
  testSavedCluster,
  deleteCluster,
  getLiveResources,
  getResourceManifest,
  getPodLogs,
} from '../controllers/clusterController.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = Router();
const canManageConnectors = requireRole(['superadmin', 'devops']);

router.get('/contexts', authenticate, getDiscoveredContexts);
router.post('/sync', authenticate, canManageConnectors, syncClustersFromKubeConfig);
router.post('/test', authenticate, canManageConnectors, testClusterConnection);
router.get('/', authenticate, getAllClusters);
router.post('/', authenticate, canManageConnectors, createClusterCredential);
router.put('/:id', authenticate, canManageConnectors, updateCluster);
router.put('/:id/default', authenticate, canManageConnectors, setDefaultCluster);
router.post('/:id/test', authenticate, canManageConnectors, testSavedCluster);
router.get('/:name', authenticate, getClusterDetails);
router.delete('/:id', authenticate, canManageConnectors, deleteCluster);

// Resource Browser routes matching Devtron screenshots
router.get('/:name/resources', authenticate, getLiveResources);
router.get('/:name/resources/:kind/:namespace/:resourceName/manifest', authenticate, getResourceManifest);
router.get('/:name/resources/:namespace/:podName/logs', authenticate, getPodLogs);

export default router;
