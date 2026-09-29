import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import {
  createDnsConnector,
  createTunnelHandler,
  createZoneRecord,
  deleteTunnelHandler,
  deleteZoneRecord,
  listTunnels,
  listZoneRecords,
  redeployTunnel,
  updateZoneRecord,
  deleteDnsConnector,
  listDnsConnectors,
  listDnsZones,
  setDefaultDnsConnector,
  testDnsConnection,
  testSavedDnsConnector,
  updateDnsConnector,
} from '../controllers/dnsController.js';
import { getPublicUrls } from '../controllers/envDnsController.js';

const router = Router();
// DNS connectors hold account-wide credentials: DevOps admins only, like the other connectors.
const canManage = requireRole(['superadmin', 'devops']);

// Everyone: filtered to the environments they can see.
router.get('/public-urls', authenticate, getPublicUrls);

router.get('/connectors', authenticate, canManage, listDnsConnectors);
router.post('/connectors/test', authenticate, canManage, testDnsConnection);
router.post('/connectors', authenticate, canManage, createDnsConnector);
router.post('/connectors/:id/test', authenticate, canManage, testSavedDnsConnector);
router.get('/connectors/:id/zones', authenticate, canManage, listDnsZones);
router.put('/connectors/:id/default', authenticate, canManage, setDefaultDnsConnector);
router.put('/connectors/:id', authenticate, canManage, updateDnsConnector);
router.delete('/connectors/:id', authenticate, canManage, deleteDnsConnector);

router.get('/connectors/:id/zones/:zoneId/records', authenticate, canManage, listZoneRecords);
router.post('/connectors/:id/zones/:zoneId/records', authenticate, canManage, createZoneRecord);
router.put('/connectors/:id/zones/:zoneId/records/:recordId', authenticate, canManage, updateZoneRecord);
router.delete('/connectors/:id/zones/:zoneId/records/:recordId', authenticate, canManage, deleteZoneRecord);

router.get('/tunnels', authenticate, canManage, listTunnels);
router.post('/tunnels', authenticate, canManage, createTunnelHandler);
router.post('/tunnels/:id/deploy', authenticate, canManage, redeployTunnel);
router.delete('/tunnels/:id', authenticate, canManage, deleteTunnelHandler);

export default router;
