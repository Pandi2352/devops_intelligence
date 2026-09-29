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
  fetchGitopsLayout,
  fetchJobTrace,
  fetchJobArtifacts,
} from '../controllers/gitController.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import {
  branchPipeline,
  closeMergeRequest,
  compareBranches,
  createMergeRequest,
  listMergeRequests,
  mergeMergeRequest,
  rebaseMergeRequest,
} from '../controllers/gitMergeController.js';

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
router.get('/:id/repos/:repoId/gitops-layout', authenticate, fetchGitopsLayout);
router.get('/:id/repos/:repoId/languages', authenticate, fetchLanguages);
router.get('/:id/repos/:repoId/pipelines', authenticate, fetchPipelines);
router.get('/:id/repos/:repoId/jobs/:jobId/trace', authenticate, fetchJobTrace);
router.get('/:id/repos/:repoId/jobs/:jobId/artifacts', authenticate, fetchJobArtifacts);
router.post('/:id/repos/:repoId/pipelines', authenticate, triggerPipeline);
router.get('/:id/repos/:repoId/compare', authenticate, compareBranches);
router.get('/:id/repos/:repoId/branch-pipeline', authenticate, branchPipeline);
router.get('/:id/repos/:repoId/merge-requests', authenticate, listMergeRequests);
router.post('/:id/repos/:repoId/merge-requests', authenticate, canManageConnectors, createMergeRequest);
router.post('/:id/repos/:repoId/merge-requests/:iid/merge', authenticate, canManageConnectors, mergeMergeRequest);
router.post('/:id/repos/:repoId/merge-requests/:iid/rebase', authenticate, canManageConnectors, rebaseMergeRequest);
router.post('/:id/repos/:repoId/merge-requests/:iid/close', authenticate, canManageConnectors, closeMergeRequest);

export default router;
