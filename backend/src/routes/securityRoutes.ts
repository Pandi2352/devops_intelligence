import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import {
  createSonarConnector,
  deleteSonarConnector,
  discoverSonar,
  getTrivyStatus,
  listSonarConnectors,
  setDefaultSonarConnector,
  testSavedSonarConnector,
  testSonarConnection,
  updateSonarConnector,
} from '../controllers/securityController.js';

const router = Router();
// Scanner connectors hold server tokens: DevOps admins only, like the other connectors.
const canManage = requireRole(['superadmin', 'devops']);

router.get('/sonar/connectors', authenticate, canManage, listSonarConnectors);
router.get('/sonar/connectors/discover', authenticate, canManage, discoverSonar);
router.post('/sonar/connectors/test', authenticate, canManage, testSonarConnection);
router.post('/sonar/connectors', authenticate, canManage, createSonarConnector);
router.post('/sonar/connectors/:id/test', authenticate, canManage, testSavedSonarConnector);
router.put('/sonar/connectors/:id/default', authenticate, canManage, setDefaultSonarConnector);
router.put('/sonar/connectors/:id', authenticate, canManage, updateSonarConnector);
router.delete('/sonar/connectors/:id', authenticate, canManage, deleteSonarConnector);
router.get('/trivy', authenticate, canManage, getTrivyStatus);

export default router;
