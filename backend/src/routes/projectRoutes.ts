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
import { approvalGate, registerApprovalHandler } from '../services/approvals.js';
import { setEnvironmentApproval } from '../controllers/approvalController.js';
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
import {
  applyEnvironmentDns,
  getProjectDns,
  quickEnvironmentDns,
  removeEnvironmentDnsRecord,
  setEnvironmentDns,
  startEnvironmentPreview,
  stopEnvironmentPreview,
} from '../controllers/envDnsController.js';
import {
  getAnalysis,
  getProjectSecurity,
  getVulnerabilityReport,
  releaseGuard,
  runAnalysis,
  setProjectSecurity,
  withReleaseGuard,
} from '../controllers/securityController.js';

const router = Router();

router.get('/', authenticate, getProjects);
router.get('/overview', authenticate, getProjectsOverview);
router.post('/', authenticate, requireManager, createProject);

// Per project: view to read, build-and-deploy on the target environment to ship, admin to change the project.
const env = (req: AuthRequest) => String(req.params.env);
router.get('/:id', authenticate, requireProject(VIEW), getProjectById);
router.get('/:id/overview', authenticate, requireProject(VIEW), getProjectOverview);
router.get('/:id/environments', authenticate, requireProject(VIEW), getProjectEnvironments);
router.post('/:id/environments/promote', authenticate, requireProject(DEPLOY, (req) => String(req.body?.to || '')), releaseGuard, approvalGate('env.promote'), promoteEnvironment);
router.get('/:id/setup', authenticate, requireProject(VIEW), getProjectSetup);
router.post('/:id/environments/add', authenticate, requireProject(ADMIN), addEnvironment);
router.get('/:id/environments/:env/checks', authenticate, requireProject(VIEW, env), getEnvironmentChecks);
router.get('/:id/environments/:env/manifests', authenticate, requireProject(VIEW, env), getEnvironmentManifests);
router.post('/:id/environments/:env/provision', authenticate, requireProject(ADMIN), provisionExistingEnvironment);
router.delete('/:id/environments/:env', authenticate, requireProject(ADMIN), removeEnvironment);
router.get('/:id/environments/:env/history', authenticate, requireProject(VIEW, env), getEnvironmentHistory);
router.get('/:id/environments/:env/details', authenticate, requireProject(VIEW, env), getEnvironmentDetails);
router.post('/:id/environments/:env/rollback', authenticate, requireProject(DEPLOY, env), approvalGate('env.rollback'), rollbackEnvironment);
router.post('/:id/environments/:env/redeploy', authenticate, requireProject(DEPLOY, env), approvalGate('env.redeploy'), redeployEnvironment);
router.put('/:id/environments/:env/approval', authenticate, setEnvironmentApproval);

// Public address: admins choose the hostname; build-and-deploy applies it (approval-gated like a deploy).
// Security: code quality (SonarQube) and image vulnerabilities (Trivy).
router.get('/:id/security', authenticate, requireProject(VIEW), getProjectSecurity);
router.put('/:id/security', authenticate, requireProject(ADMIN), setProjectSecurity);
router.get('/:id/security/analysis', authenticate, requireProject(VIEW), getAnalysis);
router.post('/:id/security/analysis', authenticate, requireProject(DEPLOY), runAnalysis);
router.get('/:id/environments/:env/vulnerabilities/:report', authenticate, requireProject(VIEW, env), getVulnerabilityReport);

router.get('/:id/dns', authenticate, requireProject(VIEW), getProjectDns);
router.put('/:id/environments/:env/dns', authenticate, requireProject(ADMIN, env), setEnvironmentDns);
router.post('/:id/environments/:env/dns/apply', authenticate, requireProject(DEPLOY, env), approvalGate('dns.apply'), applyEnvironmentDns);
router.post('/:id/environments/:env/dns/quick', authenticate, requireProject(ADMIN, env), approvalGate('dns.quick'), quickEnvironmentDns);
router.delete('/:id/environments/:env/dns/record', authenticate, requireProject(DEPLOY, env), approvalGate('dns.remove'), removeEnvironmentDnsRecord);
router.post('/:id/environments/:env/preview', authenticate, requireProject(DEPLOY, env), approvalGate('preview.start'), startEnvironmentPreview);
router.delete('/:id/environments/:env/preview', authenticate, requireProject(DEPLOY, env), stopEnvironmentPreview);

registerApprovalHandler('env.promote', withReleaseGuard(promoteEnvironment));
registerApprovalHandler('env.rollback', rollbackEnvironment);
registerApprovalHandler('env.redeploy', redeployEnvironment);
registerApprovalHandler('dns.apply', applyEnvironmentDns);
registerApprovalHandler('dns.quick', quickEnvironmentDns);
registerApprovalHandler('dns.remove', removeEnvironmentDnsRecord);
registerApprovalHandler('preview.start', startEnvironmentPreview);
router.put('/:id', authenticate, requireProject(ADMIN), updateProject);
router.delete('/:id', authenticate, requireRole(['superadmin']), deleteProject);

export default router;
