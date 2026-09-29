import React, { useState, useRef, useEffect } from 'react';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';
import { Bot, Send, Sparkles, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { approvalApi } from '../../api/approvalApi';
import { projectApi } from '../../api/projectApi';
import { getApiErrorMessage } from '../../api/client';
import { Dropdown } from '../common/Dropdown';

interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
  actionCard?: {
    type: 'APPROVAL_PROMPT';
    project: string;
    action: 'RESTART_POD' | 'SCALE_DEPLOYMENT' | 'PROD_DEPLOY';
    resource: string;
    reason: string;
    status?: 'PENDING' | 'SUBMITTED';
  };
}

const DEFAULT_QUESTIONS = [
  'Explain our full CI/CD & GitOps pipeline flow',
  'What is the difference between Snyk, SonarQube, and Trivy?',
  'Why do we use yq to generate Kubernetes YAML?',
  'How does ArgoCD GitOps work with our Kubernetes cluster?',
  'Request a pod restart (needs manager approval)',
];

export const DevOpsCopilot: React.FC = () => {
  const { user } = useAuth();
  // Only the projects this user can see (the API filters them).
  const [projects, setProjects] = useState<string[]>([]);
  const [selectedProject, setSelectedProject] = useState('');
  useEffect(() => {
    projectApi
      .list()
      .then((list) => {
        setProjects(list.map((p) => p.name));
        setSelectedProject((cur) => cur || list[0]?.name || '');
      })
      .catch(() => setProjects([]));
  }, []);
  const [inputMessage, setInputMessage] = useState('');
  const [isSubmittingApproval, setIsSubmittingApproval] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome-1',
      sender: 'assistant',
      text: `👋 Welcome ${user?.name || 'Engineer'}! I am your **DevOps Intelligence DevOps Copilot**.\n\nI can explain your company's full **GitLab CI + Security + ArgoCD GitOps** architecture, breakdown pipeline stages, or help you submit **Manager Approval Requests** for sensitive cluster operations (like pod restarts and deployment scaling).`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const generateAnswer = (query: string): { text: string; actionCard?: ChatMessage['actionCard'] } => {
    const q = query.toLowerCase();

    // 1. Pod Restart or write operation requiring approval
    if ((q.includes('restart pod') || q.includes('restart') || q.includes('scale')) && !selectedProject) {
      return { text: 'You have no project access yet, so there is nothing to request a restart for. Ask a DevOps admin to grant you a project.' };
    }
    if (q.includes('restart pod') || q.includes('restart') || q.includes('scale')) {
      const isScale = q.includes('scale');
      return {
        text: `⚠️ **Write Operation Guardrail Detected**:\n\nYou are requesting to **${isScale ? 'scale deployment replicas' : 'restart active pod'}** for project \`${selectedProject}\`.\n\nUnder your organization's RBAC governance, write and mutating queries to active cluster workloads require **DevOps Manager Authorization** before execution. Would you like me to submit an approval request?`,
        actionCard: {
          type: 'APPROVAL_PROMPT',
          project: selectedProject,
          action: isScale ? 'SCALE_DEPLOYMENT' : 'RESTART_POD',
          resource: `deployment/${selectedProject}`,
          reason: 'Memory stabilization and operational restart requested via Copilot',
          status: 'PENDING',
        },
      };
    }

    // 2. Full Flow explanation
    if (q.includes('flow') || q.includes('pipeline') || q.includes('stages')) {
      return {
        text: `### 🚀 Your Company's Complete CI/CD & GitOps Flow:\n\n1. **Developer Push**: Code push to branch (\`dev\`, \`staging-qa\`, \`prod\`) triggers GitLab CI.\n2. **Stage 1 — Snyk Code Scan**: Runs \`ukjaiswal/snyk-alpine\` to scan dependencies for known CVEs.\n3. **Stage 2 — SonarQube**: Inspects code quality, test coverage, and code smells using OpenJDK 17 + \`sonar-scanner\`.\n4. **Stage 3 — Build Application**: Compiles Node/NestJS (\`npm run build\`) and packages \`dist/\` with environment-specific configs (\`mongo.$SLUG.json\`).\n5. **Stage 4 — Docker Build & Trivy Scan**: Builds Docker image via Docker-in-Docker (\`docker:dind\`), then **Trivy** scans the final container image for OS/library vulnerabilities.\n6. **Stage 5 — Container Registry**: Pushes image to GitLab Container Registry with deterministic tags (\`branch-date-sha-pipelineid\`).\n7. **Stage 6 — Dynamic K8s YAML Generator**: Uses \`yq-alpine\` to inject image, namespace (\`dms-$SLUG-apps\`), secrets, and port \`3000\` into \`kube-config.yaml\`.\n8. **Stage 7 — ArgoCD GitOps Publish**: Commits \`kube-config.yaml\` to the ArgoCD Git repo. ArgoCD synchronizes the desired state into Minikube/Kubernetes.`,
      };
    }

    // 3. Snyk vs Trivy vs SonarQube
    if (q.includes('snyk') || q.includes('trivy') || q.includes('sonar') || q.includes('difference')) {
      return {
        text: `### 🛡️ The 3 Security Pillars in your Pipeline:\n\n- **Snyk (Source & Dependency Scanning)**:\n  - Scans \`package.json\` and \`node_modules\` before the app builds.\n  - Catches vulnerable third-party dependencies.\n\n- **SonarQube (Static Analysis & SAST)**:\n  - Analyzes your TypeScript/JavaScript source code quality, duplications, complexity, and security hotspots.\n\n- **Trivy (Container Image Vulnerability Scanning)**:\n  - Scans the **final built Docker image**.\n  - Catches OS-level package vulnerabilities (e.g. Alpine/Debian CVEs) that Snyk cannot see.`,
      };
    }

    // 4. yq and dynamic YAML
    if (q.includes('yq') || q.includes('yaml') || q.includes('manifest')) {
      return {
        text: `### ⚙️ Why Your Company Uses \`yq\` for Manifests:\n\nInstead of writing static Kubernetes YAML files for every branch, your CI pipeline uses \`ukjaiswal/yq-alpine\` to inject dynamic values:\n\n1. **Dynamic App Name**: \`.metadata.name = "$CI_PROJECT_NAME-$CI_COMMIT_BRANCH"\`\n2. **Target Namespace**: \`.metadata.namespace = "dms-$CI_COMMIT_REF_SLUG-apps"\`\n3. **Image Tag**: Injects \`$DOCKER_IMAGE_NAME\` so the Pod pulls the exact build from this commit.\n4. **Secrets & Ports**: Attaches Kubernetes secrets (\`dms-dev-v2-env\`) and configures container port \`3000\`.\n\nThis ensures 100% environment isolation between \`dev\`, \`staging\`, and \`prod\`!`,
      };
    }

    // 5. ArgoCD GitOps
    if (q.includes('argocd') || q.includes('gitops')) {
      return {
        text: `### 🐙 How ArgoCD GitOps Works in Your Stack:\n\n- In traditional DevOps, GitLab CI runs \`kubectl apply\` directly. If the cluster is unreachable or credentials expire, deployments fail.\n- In **GitOps (Your Stack)**:\n  1. GitLab CI commits the finalized \`kube-config.yaml\` into a dedicated **ArgoCD Git repository** (\`$ARGOCD_GIT_COMMIT\`).\n  2. **ArgoCD** continuously monitors this Git repository.\n  3. When it detects a new commit, it reconciles the cluster to match the Git repository automatically.\n  4. If a Pod crashes or changes occur on the cluster, ArgoCD automatically heals the state!`,
      };
    }

    // Default response
    return {
      text: `I understand you are asking about: "${query}" for project **${selectedProject}**.\n\nIn our platform, each microservice follows **GitLab CI → Snyk/Sonar → Docker/Trivy → yq Generator → ArgoCD GitOps**. You can ask me to explain any specific stage, compare security tools, or request manager approval for cluster operations.`,
    };
  };

  const handleSendMessage = (textToSend?: string) => {
    const text = textToSend || inputMessage;
    if (!text.trim()) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    const answer = generateAnswer(text);

    const botMsg: ChatMessage = {
      id: `bot-${Date.now() + 1}`,
      sender: 'assistant',
      text: answer.text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      actionCard: answer.actionCard,
    };

    setMessages((prev) => [...prev, userMsg, botMsg]);
    if (!textToSend) setInputMessage('');
  };

  const handleSubmitApproval = async (card: NonNullable<ChatMessage['actionCard']>, msgId: string) => {
    setIsSubmittingApproval(true);
    try {
      await approvalApi.create({
        projectName: card.project,
        action: card.action,
        resource: card.resource,
        reason: card.reason,
      });

      // Update card status in message
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId && m.actionCard
            ? { ...m, actionCard: { ...m.actionCard, status: 'SUBMITTED' } }
            : m
        )
      );
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: `bot-${Date.now()}`,
          sender: 'assistant',
          text: `Could not submit the approval request: ${getApiErrorMessage(err, 'request failed')}`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } finally {
      setIsSubmittingApproval(false);
    }
  };

  return (
    <div className="h-[calc(100vh-140px)] flex flex-col bg-white border border-slate-200 rounded-md">
      {/* Header with Project Selector */}
      <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-md bg-sky-600 flex items-center justify-center text-white">
            <Bot size={18} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm text-slate-900">DevOps Intelligence DevOps Copilot</span>
              <span className="px-1.5 py-0.2 rounded-md bg-sky-100 text-sky-700 text-[10px] font-mono font-bold border border-sky-200">
                Guided answers
              </span>
            </div>
            <p className="text-[11px] text-slate-500">Project-Aware Learning Assistant & Approval Dispatcher</p>
          </div>
        </div>

        {/* Project Context Picker */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 font-medium" aria-hidden>
            Context Project:
          </span>
          <Dropdown<string>
            ariaLabel="Context project"
            value={selectedProject}
            onChange={setSelectedProject}
            align="right"
            placeholder={projects.length ? 'Pick a project' : 'No projects assigned'}
            disabled={!projects.length}
            options={projects.map((p) => ({ value: p, label: p }))}
          />
        </div>
      </div>

      {/* Messages Chat Area */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
          >
            <div
              className={`max-w-2xl p-4 rounded-md text-xs leading-relaxed ${
                msg.sender === 'user'
                  ? 'bg-sky-600 text-white'
                  : 'bg-slate-50 border border-slate-200 text-slate-800'
              }`}
            >
              {/* Formatted Text */}
              <div className="whitespace-pre-line font-sans">{msg.text}</div>

              {/* Action Card for Approvals */}
              {msg.actionCard && (
                <div className="mt-3 p-3 rounded-md bg-white border border-amber-300 text-slate-900">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-bold text-xs text-amber-800 flex items-center gap-1.5">
                      <AlertTriangle size={14} className="text-amber-600" />
                      Manager Approval Ticket
                    </span>
                    <Badge
                      label={msg.actionCard.status === 'SUBMITTED' ? 'Queued' : 'Approval Required'}
                      variant={msg.actionCard.status === 'SUBMITTED' ? 'healthy' : 'degraded'}
                    />
                  </div>

                  <div className="text-[11px] font-mono space-y-1 mb-3 text-slate-600">
                    <div>Project: <strong className="text-slate-800">{msg.actionCard.project}</strong></div>
                    <div>Target Resource: <strong className="text-slate-800">{msg.actionCard.resource}</strong></div>
                    <div>Action: <strong className="text-sky-700">{msg.actionCard.action}</strong></div>
                    <div>Requested By: <strong className="text-slate-800">{user?.name || 'Developer'} ({user?.role || 'developer'})</strong></div>
                  </div>

                  {msg.actionCard.status === 'SUBMITTED' ? (
                    <div className="p-2 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] flex items-center gap-1.5">
                      <CheckCircle2 size={14} className="text-emerald-600" />
                      Request sent to DevOps Manager Approval Queue (Check &quot;Manager Approvals&quot; page).
                    </div>
                  ) : (
                    <Button
                      variant="primary"
                      size="sm"
                      className="w-full"
                      isLoading={isSubmittingApproval}
                      onClick={() => handleSubmitApproval(msg.actionCard!, msg.id)}
                    >
                      Submit Manager Approval Request
                    </Button>
                  )}
                </div>
              )}
            </div>

            <span className="text-[10px] text-slate-400 mt-1 px-1">{msg.timestamp}</span>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Suggested Quick Prompt Chips */}
      <div className="px-5 py-2.5 border-t border-slate-100 bg-slate-50 flex items-center gap-1.5 overflow-x-auto text-xs">
        <span className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider shrink-0 flex items-center gap-1">
          <Sparkles size={12} className="text-sky-600" /> Quick Learn:
        </span>
        {DEFAULT_QUESTIONS.map((q) => (
          <button
            key={q}
            onClick={() => handleSendMessage(q)}
            className="px-2.5 py-1 rounded-md bg-white border border-slate-200 hover:border-sky-500 hover:text-sky-700 text-slate-700 text-[11px] font-medium whitespace-nowrap transition-colors"
          >
            {q}
          </button>
        ))}
      </div>

      {/* Input Field */}
      <div className="p-3 border-t border-slate-200 bg-white flex items-center gap-2">
        <input
          type="text"
          placeholder={`Ask about ${selectedProject ? `${selectedProject}'s` : 'the'} pipeline, Snyk, Trivy, ArgoCD, or request a pod restart`}
          value={inputMessage}
          onChange={(e) => setInputMessage(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
          className="flex-1 px-3 py-2 rounded-md bg-slate-50 border border-slate-300 text-slate-900 text-xs focus:border-sky-600 focus:bg-white"
        />
        <Button
          variant="primary"
          size="sm"
          onClick={() => handleSendMessage()}
          leftIcon={<Send size={13} />}
        >
          Send
        </Button>
      </div>
    </div>
  );
};
