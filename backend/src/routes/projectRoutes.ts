import { Router } from 'express';
import {
  getProjects,
  getProjectById,
  createProject,
  updateProject,
  deleteProject,
} from '../controllers/projectController.js';
import { authenticate, requireRole } from '../middleware/auth.js';
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

router.get('/', getProjects);
router.get('/overview', authenticate, getProjectsOverview);
router.get('/:id', getProjectById);
router.get('/:id/overview', authenticate, getProjectOverview);
router.get('/:id/environments', authenticate, getProjectEnvironments);
router.post('/:id/environments/promote', authenticate, requireRole(['superadmin', 'devops']), promoteEnvironment);
router.get('/:id/setup', authenticate, getProjectSetup);
router.post('/:id/environments/add', authenticate, requireRole(['superadmin', 'devops']), addEnvironment);
router.get('/:id/environments/:env/checks', authenticate, getEnvironmentChecks);
router.get('/:id/environments/:env/manifests', authenticate, getEnvironmentManifests);
router.post('/:id/environments/:env/provision', authenticate, requireRole(['superadmin', 'devops']), provisionExistingEnvironment);
router.delete('/:id/environments/:env', authenticate, requireRole(['superadmin', 'devops']), removeEnvironment);
router.get('/:id/environments/:env/history', authenticate, getEnvironmentHistory);
router.get('/:id/environments/:env/details', authenticate, getEnvironmentDetails);
router.post('/:id/environments/:env/rollback', authenticate, requireRole(['superadmin', 'devops']), rollbackEnvironment);
router.post('/:id/environments/:env/redeploy', authenticate, requireRole(['superadmin', 'devops']), redeployEnvironment);
router.post('/', authenticate, requireRole(['superadmin', 'devops']), createProject);
router.put('/:id', authenticate, requireRole(['superadmin', 'devops']), updateProject);
router.delete('/:id', authenticate, requireRole(['superadmin']), deleteProject);

export default router;
