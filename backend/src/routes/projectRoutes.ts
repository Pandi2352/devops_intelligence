import { Router } from 'express';
import {
  getProjects,
  getProjectById,
  createProject,
  updateProject,
  deleteProject,
} from '../controllers/projectController.js';
import { AuthRequest, authenticate, requireManager, requireProject, requireRole } from '../middleware/auth.js';
import { ADMIN, DEPLOY, VIEW } from '../services/access.js';
import { getProjectOverview, getProjectsOverview } from '../controllers/projectOverviewController.js';
import {
  getProjectEnvironments,
  promoteEnvironment,
  getEnvironmentHistory,
  rollbackEnvironment,
  redeployEnvironment,
  getEnvironmentDetails,
} from '../controllers/environmentController.js';
import {
  getProjectSetup,
  getEnvironmentChecks,
  addEnvironment,
  provisionExistingEnvironment,
  removeEnvironment,
  getEnvironmentManifests,
} from '../controllers/projectEnvironmentController.js';

const router = Router();

router.get('/', authenticate, getProjects);
router.get('/overview', authenticate, getProjectsOverview);
router.post('/', authenticate, requireManager, createProject);

// Per project: view to read, build-and-deploy on the target environment to ship, admin to change the project.
const env = (req: AuthRequest) => String(req.params.env);
router.get('/:id', authenticate, requireProject(VIEW), getProjectById);
router.get('/:id/overview', authenticate, requireProject(VIEW), getProjectOverview);
router.get('/:id/environments', authenticate, requireProject(VIEW), getProjectEnvironments);
router.post('/:id/environments/promote', authenticate, requireProject(DEPLOY, (req) => String(req.body?.to || '')), promoteEnvironment);
router.get('/:id/setup', authenticate, requireProject(VIEW), getProjectSetup);
router.post('/:id/environments/add', authenticate, requireProject(ADMIN), addEnvironment);
router.get('/:id/environments/:env/checks', authenticate, requireProject(VIEW, env), getEnvironmentChecks);
router.get('/:id/environments/:env/manifests', authenticate, requireProject(VIEW, env), getEnvironmentManifests);
router.post('/:id/environments/:env/provision', authenticate, requireProject(ADMIN), provisionExistingEnvironment);
router.delete('/:id/environments/:env', authenticate, requireProject(ADMIN), removeEnvironment);
router.get('/:id/environments/:env/history', authenticate, requireProject(VIEW, env), getEnvironmentHistory);
router.get('/:id/environments/:env/details', authenticate, requireProject(VIEW, env), getEnvironmentDetails);
router.post('/:id/environments/:env/rollback', authenticate, requireProject(DEPLOY, env), rollbackEnvironment);
router.post('/:id/environments/:env/redeploy', authenticate, requireProject(DEPLOY, env), redeployEnvironment);
router.put('/:id', authenticate, requireProject(ADMIN), updateProject);
router.delete('/:id', authenticate, requireRole(['superadmin']), deleteProject);

export default router;
