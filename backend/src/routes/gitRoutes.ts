import { Router } from 'express';
import {
  listGitIntegrations,
  saveGitIntegration,
  updateGitIntegration,
  deleteGitIntegration,
  testGitConnection,
  testSavedGitIntegration,
  fetchRepositories,
  fetchPipelines,
  triggerPipeline,
  fetchCommits,
  fetchBranches,
  fetchLanguages,
  listWorkspaceTemplates,
  createGitLabProject,
  pushWorkspaceTemplate,
  fetchJobTrace,
  fetchJobArtifacts,
} from '../controllers/gitController.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = Router();
const canManageConnectors = requireRole(['superadmin', 'devops']);

router.get('/', authenticate, listGitIntegrations);
router.get('/integrations', authenticate, listGitIntegrations);
router.post('/', authenticate, canManageConnectors, saveGitIntegration);
router.post('/integrations', authenticate, canManageConnectors, saveGitIntegration);
router.post('/test', authenticate, canManageConnectors, testGitConnection);
router.get('/templates', authenticate, listWorkspaceTemplates);
router.put('/:id', authenticate, canManageConnectors, updateGitIntegration);
router.delete('/:id', authenticate, canManageConnectors, deleteGitIntegration);
router.post('/:id/test', authenticate, canManageConnectors, testSavedGitIntegration);
router.get('/:id/repos', authenticate, fetchRepositories);
router.post('/:id/projects', authenticate, canManageConnectors, createGitLabProject);
router.post('/:id/repos/:repoId/push-template', authenticate, canManageConnectors, pushWorkspaceTemplate);
router.get('/:id/repos/:repoId/commits', authenticate, fetchCommits);
router.get('/:id/repos/:repoId/branches', authenticate, fetchBranches);
router.get('/:id/repos/:repoId/languages', authenticate, fetchLanguages);
router.get('/:id/repos/:repoId/pipelines', authenticate, fetchPipelines);
router.get('/:id/repos/:repoId/jobs/:jobId/trace', authenticate, fetchJobTrace);
router.get('/:id/repos/:repoId/jobs/:jobId/artifacts', authenticate, fetchJobArtifacts);
router.post('/:id/repos/:repoId/pipelines', authenticate, triggerPipeline);

export default router;
