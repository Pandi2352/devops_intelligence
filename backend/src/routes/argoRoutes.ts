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
import { AuthRequest, authenticate, requireManager, requireRole } from '../middleware/auth.js';
import { Level, LEVEL_NAME, VIEW, DEPLOY, envLevel, envNameOf, isManager } from '../services/access.js';
import { Project } from '../models/Project.js';
import { NextFunction, Response } from 'express';
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

// ArgoCD apps belong to a project environment; apps no project maps are for managers only.
const requireApp = (needed: Level) => async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (isManager(req.user)) return next();
  const name = String(req.params.name);
  const project = await Project.findOne({ 'argoApps.appName': name });
  const app = project?.argoApps.find((a) => a.appName === name);
  if (!project || !app || envLevel(req.user, project.name, envNameOf(app)) < needed) {
    res.status(403).json({ message: `You need ${LEVEL_NAME[needed]} access to ${project ? `${project.name} · ${envNameOf(app!)}` : 'this application'}.` });
    return;
  }
  next();
};
const canManageConnectors = requireRole(['superadmin', 'devops']);

router.get('/status', authenticate, getArgoStatus);
router.post('/config', authenticate, canManageConnectors, updateArgoConfig);
router.get('/applications', authenticate, requireManager, listArgoApplications);
router.post('/applications/:name/sync', authenticate, canManageConnectors, syncArgoApplication);

router.get('/connectors', authenticate, requireManager, listArgoConnectors);
router.post('/connectors', authenticate, canManageConnectors, createArgoConnector);
router.post('/connectors/test', authenticate, canManageConnectors, testArgoConnection);
router.put('/connectors/:id', authenticate, canManageConnectors, updateArgoConnector);
router.put('/connectors/:id/default', authenticate, canManageConnectors, setDefaultArgoConnector);
router.delete('/connectors/:id', authenticate, canManageConnectors, deleteArgoConnector);
router.post('/connectors/:id/test', authenticate, canManageConnectors, testSavedArgoConnector);

// Application explorer
router.get('/apps', authenticate, listApps);
router.get('/apps/:name', authenticate, requireApp(VIEW), getApp);
router.get('/apps/:name/tree', authenticate, requireApp(VIEW), getAppTree);
router.get('/apps/:name/diff', authenticate, requireApp(VIEW), getAppDiff);
router.get('/apps/:name/events', authenticate, requireApp(VIEW), getAppEvents);
router.post('/apps/:name/refresh', authenticate, requireApp(VIEW), refreshApp);
router.post('/apps/:name/sync', authenticate, requireApp(DEPLOY), syncApp);
router.post('/apps/:name/rollback', authenticate, requireApp(DEPLOY), rollbackApp);
router.delete('/apps/:name/operation', authenticate, requireApp(DEPLOY), terminateOperation);

export default router;
