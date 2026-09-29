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
import { requireRepo } from '../services/gitAccess.js';
import { DEPLOY, VIEW } from '../services/access.js';
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
router.get('/:id/repos/:repoId/commits', authenticate, requireRepo(VIEW), fetchCommits);
router.get('/:id/repos/:repoId/branches', authenticate, requireRepo(VIEW), fetchBranches);
router.get('/:id/repos/:repoId/gitops-layout', authenticate, requireRepo(VIEW), fetchGitopsLayout);
router.get('/:id/repos/:repoId/languages', authenticate, requireRepo(VIEW), fetchLanguages);
router.get('/:id/repos/:repoId/pipelines', authenticate, requireRepo(VIEW), fetchPipelines);
router.get('/:id/repos/:repoId/jobs/:jobId/trace', authenticate, requireRepo(VIEW), fetchJobTrace);
router.get('/:id/repos/:repoId/jobs/:jobId/artifacts', authenticate, requireRepo(VIEW), fetchJobArtifacts);
router.post('/:id/repos/:repoId/pipelines', authenticate, requireRepo(DEPLOY, (req) => String(req.body?.ref || 'main')), triggerPipeline);
router.get('/:id/repos/:repoId/compare', authenticate, requireRepo(VIEW), compareBranches);
router.get('/:id/repos/:repoId/branch-pipeline', authenticate, requireRepo(VIEW), branchPipeline);
router.get('/:id/repos/:repoId/merge-requests', authenticate, requireRepo(VIEW), listMergeRequests);
router.post('/:id/repos/:repoId/merge-requests', authenticate, requireRepo(DEPLOY, (req) => String(req.body?.target || '')), createMergeRequest);
router.post('/:id/repos/:repoId/merge-requests/:iid/merge', authenticate, requireRepo(DEPLOY, () => '*'), mergeMergeRequest);
router.post('/:id/repos/:repoId/merge-requests/:iid/rebase', authenticate, requireRepo(DEPLOY, () => '*'), rebaseMergeRequest);
router.post('/:id/repos/:repoId/merge-requests/:iid/close', authenticate, requireRepo(DEPLOY, () => '*'), closeMergeRequest);

export default router;
