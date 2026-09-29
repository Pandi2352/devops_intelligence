# AI Project Starter: Plan

A chatbot in DevOps Intelligence that interviews you about a new application, proposes a setup with
**verified latest package versions**, generates a working frontend and/or backend project, **checks it
builds**, **creates the repository** (GitHub or GitLab) from the UI, **pushes** the code, and **tracks
every step**. AI models come from **AI provider connectors** (ChatGPT/OpenAI, Gemini, Ollama local or
cloud, Claude and any OpenAI-compatible API).

Status: **v1 built**. See "v1 as built" below. The rest of this document is the full plan; sections
marked *(not in v1)* were dropped by decision.

## v1 as built (decisions: ChatGPT first · every stack · GitHub + GitLab · managers only · no build/DevOps)

| Part | Where | What it does |
|---|---|---|
| **AI connector** | Connectors → AI | OpenAI (ChatGPT API) or any OpenAI-compatible API: encrypted key, *Test & load models* (live list), default model, max output tokens, token usage counter |
| **GitHub connector** | Connectors → GitHub | Token check (scopes, orgs), every repository the token can see; not mapped to projects |
| **Project Starter** | Sidebar → Project Starter (`/starter`, managers only) | Chat interview for **any** stack → **Generate project** → review/edit files → **Create repository & push** |
| **Latest versions** | AI tool `lookup_latest_version` | npm, PyPI, Go, Maven, NuGet, RubyGems, crates.io, Packagist, pub.dev, Docker Hub, runtimes (endoflife.date); the AI must call it for every version it states |
| **Generation** | background | Plan JSON (stack with verified versions, file list), then files in batches of 6 with structured output; unsafe paths, lock files and unrequested files are dropped; max 150 files / 200 KB each / 4 MB |
| **Push** | GitHub or GitLab | Owner picker (you, orgs, groups); refuses existing repository names; GitHub: repo + one commit via the Git Data API; GitLab: project + one commit with create actions |
| **Tracker** | Project Starter → Tracker | Requirements → Plan & versions → Generate files → Review → Create repository → Upload → Commit, with messages, times, errors and token usage |
| **Audit** | Audit log | AI connector changes, conversations started, generation, pushes (action *Project Starter*) |

Not in v1 by decision: sandbox build/test validation, CI/Docker/Kubernetes setup beyond what the user
asks the AI to include as files, deployment, non-manager access. Test suite: `npm run test:starter`
(fake OpenAI/GitHub/GitLab, real registries).

---

## 1. What the user experiences

```
Project Starter (new menu)
┌──────────────────────────────┬──────────────────────────────────────────┐
│ Chat                         │ Plan / Files / Tracker (tabs)            │
│                              │                                          │
│ 🤖 What are you building?     │ Stack: React 19 + Vite · Express 5 · PG  │
│ 👤 A todo app with login      │ Versions: react 19.x (latest ✓) …        │
│ 🤖 Frontend and backend?      │ Files: 38 · Validation: build ✓ test ✓   │
│    [Both] [Frontend] [API]   │ Tracker: ●Plan ●Versions ●Generate        │
│ …                            │          ●Validate ○Repo ○Push ○CI         │
│ [Approve plan] [Change…]     │ [Create repository & push]               │
└──────────────────────────────┴──────────────────────────────────────────┘
```

1. **Pick an AI provider/model** (default from settings).
2. **Describe the idea** in one sentence.
3. **Interview:** the bot asks only what it cannot infer, each question with a **recommended default**
   and quick-reply buttons (section 3). "Use recommended for the rest" finishes early.
4. **Plan review:** stack, folder structure, packages with **verified versions**, scripts, CI and Docker
   choices. Edit anything, or ask the bot to change it.
5. **Generate:** file tree with a code viewer; regenerate one file or ask for changes in chat.
6. **Validate:** install, lint, build and test run in an isolated sandbox. Failures are sent back to the
   AI for a fix (at most 3 rounds), and the logs are shown.
7. **Repository:** pick a connector (GitHub/GitLab), owner (user or org/group), name, visibility,
   description and topics. DevOps Intelligence creates it.
8. **Push:** initial commit on `main` (and optional `dev` branch), README, `.gitignore`, license, CI.
9. **Tracker:** every step with state, time, logs and retry; resumable if the browser closes.
10. **Optional:** register it as a DevOps Intelligence project (environments, GitOps) in one click.

---

## 2. Architecture

```
Frontend (Project Starter page)
   │  chat stream (SSE/Socket.io) · plan JSON · file tree · tracker
Backend
   ├── AI gateway ──────────► provider adapters: OpenAI · Gemini · Ollama · Claude · OpenAI-compatible
   ├── Starter orchestrator (state machine per run, persisted in MongoDB)
   │     interview → plan → resolve versions → generate → validate → create repo → push → CI → register
   ├── Version resolver ───► npm registry · PyPI · Go proxy · Maven Central · Docker Hub · nodejs.org · endoflife.date · OSV.dev
   ├── Template library (reuse services/workspaceTemplates.ts + new curated templates)
   ├── Sandbox runner ─────► Kubernetes Job (install/lint/build/test), no secrets, CPU/memory limits
   └── Git publisher ──────► GitHub REST (repos + Git Data API) · GitLab REST (projects + commits API)
```

**Reuse what exists:**
- `services/workspaceTemplates.ts`: template files with blob SHAs
- `pushWorkspaceTemplate` and `createGitLabProject` (GitLab create and push)
- `CreateRepoModal`: GitLab repository form
- the approvals and audit log
- the connector pattern (encrypted secrets, Test, default)

---

## 3. Questions the chatbot asks

Grouped, skippable, each with a recommended default (in *italics*):

| Area | Question | Options (default *italic*) |
|---|---|---|
| Basics | Name, one-line description | free text; name → slug for the repo |
| Scope | What to create | *Frontend + backend* · frontend only · backend/API only · monorepo |
| Frontend | Framework | *React + Vite* · Next.js · Vue + Vite · Angular · SvelteKit |
| | Language · styling | *TypeScript* · JS / *Tailwind CSS* · CSS modules · MUI · shadcn/ui |
| | Routing · data fetching | *React Router* · TanStack Router / *TanStack Query* · fetch |
| Backend | Runtime · framework | *Node.js + Express* · NestJS · Fastify · Python FastAPI · Django · Go (chi/gin) · Java Spring Boot |
| | API style | *REST (+ OpenAPI)* · GraphQL · tRPC |
| Data | Database · access | *PostgreSQL + Prisma* · MongoDB + Mongoose · MySQL · SQLite · none |
| Auth | Authentication | *none for now* · JWT email/password · OAuth (Google/GitHub) · Keycloak/OIDC |
| Quality | Tests | *Vitest / Jest / Pytest* + optional Playwright e2e |
| | Lint · format | *ESLint + Prettier* · Biome · Ruff (Python) |
| Tooling | Package manager · runtime version | *npm* · pnpm · yarn · bun · uv/poetry / *current LTS* |
| Delivery | Container | *Dockerfile (multi-stage, non-root) + docker-compose for local DB* · none |
| | CI | *GitHub Actions* or *GitLab CI* (matches the repo host): lint, test, build, image push |
| | Deploy target | *none yet* · DevOps Intelligence GitOps (k8s manifests + ArgoCD) · Helm chart |
| Repo | Host · owner · visibility | connector · user/org/group · *private* |
| | Branches · protection | *main* (+ dev) · protect main, require PR |
| | License · docs | *MIT* · Apache-2.0 · none / README, CONTRIBUTING, `.env.example` |
| Tracker | Starter issues | *no* · create issues/milestone for the next steps (GitHub Issues / GitLab issues) |

The bot must **not** ask what the user already answered, and must **confirm** before creating anything
outside DevOps Intelligence (the repo).

---

## 4. Latest versions: verified, never guessed

LLMs remember old versions. Every package, runtime and base image is **resolved from the registry**, and
the AI only proposes names.

| Ecosystem | Source (public, no key) |
|---|---|
| npm | `https://registry.npmjs.org/<pkg>`: `dist-tags.latest`, `engines`, `peerDependencies`, `deprecated` |
| Python | `https://pypi.org/pypi/<pkg>/json`: latest non-pre-release, `requires_python` |
| Go | `https://proxy.golang.org/<module>/@latest` |
| Java | Maven Central search API |
| Runtimes | `https://nodejs.org/dist/index.json` (latest **LTS**), `https://endoflife.date/api/<product>.json` |
| Docker images | Docker Hub tags API (e.g. the matching `node:<lts>-alpine`) |
| Security | OSV.dev (`https://api.osv.dev/v1/query`): known vulnerabilities of the chosen version |

**Rules:**
- **Stable only:** latest stable release, never a pre-release (`-beta`, `-rc`, `next`).
- **Compatibility:** peer dependencies must agree, and `engines` must match the chosen runtime.
- **Pin sensibly:** caret ranges in `package.json`, and the lockfile is created by a **real install in
  the sandbox**, never written by the AI.
- **Typosquatting guard:** the package must exist, not be deprecated, be over 6 months old, and have
  real download counts (npm downloads API). Otherwise warn and ask.
- **Caching:** results are cached for 1 hour. The plan shows a versions table (package, version,
  released, source ✓) that the user approves.

---

## 5. Generating the project

**Hybrid: templates plus AI.**
1. **Skeleton from curated templates:** vetted, versioned folders like the existing `devops-demo/`
   ones, e.g. `react-vite-ts`, `express-ts`, `fastapi`, with Dockerfile and CI. Deterministic and reviewed.
2. **Versions filled in** from section 4.
3. **AI adds the project-specific parts:** models, routes, pages, README, `.env.example`. It returns
   **structured output** (a JSON list of `{path, content}`), which is validated:
   - paths stay inside the project
   - no secrets
   - the size limit holds
   - text files only
4. **Sandbox validation:**
   - **Isolation:** a Kubernetes Job in namespace `starter-sandbox`, with an emptyDir workspace, CPU
     and memory limits, a 10-minute deadline, and no cluster credentials.
   - **Network:** a NetworkPolicy allows only the package registries.
   - **What it runs:** install → lint → build → test.
   - **On failure:** the logs go back to the AI, which returns a patch; up to 3 rounds, then the user
     decides.
5. **Review:** file tree plus viewer, diffs after every change, and **Approve** before publishing.

On a laptop (minikube capped at about 8 GB) the sandbox runs one Job at a time with 1 CPU / 1.5 GB.

---

## 6. Creating the repository and pushing

| Host | Create | Push (no git binary needed) |
|---|---|---|
| **GitHub** | `POST /user/repos` or `POST /orgs/{org}/repos` (name, private, description, `auto_init: false`); topics via `PUT /repos/{o}/{r}/topics` | Git Data API: blobs → tree → commit → `refs/heads/main`; branch protection via `PUT /repos/{o}/{r}/branches/main/protection` |
| **GitLab** | `POST /projects` (namespace_id, visibility): reuse `createGitLabProject` | Commits API with `actions` (reuse `pushWorkspaceTemplate`); protected branches API |

**Details:**
- **Name taken:** if the repository already exists, offer three choices: a new name, push to an empty
  existing repo, or cancel. Never overwrite a non-empty repository.
- **Token permissions:** the token needs
  - GitHub classic: `repo`, `workflow`, `read:org`
  - GitHub fine-grained: Administration, Contents and Workflows (write)
  - GitLab: `api`

  The GitHub connector Test already reports the scopes.
- **Secrets:** CI files are pushed without secrets. The tracker lists the CI variables to add (for
  example the registry or deploy key) and can add them via the API when the token allows.
- **Approval (optional):** creating repos in an **organization** can require an approval, using the
  existing approvals system.
- **Audit:** every create and push is recorded.

---

## 7. Tracker

**Run tracker:** a `StarterRun` document per project idea. The steps are:

```
interview → plan → versions → generate → validate → review → create-repo → push → ci-setup → register → done
```

For each step, the tracker stores:
- state: pending / running / done / failed / skipped
- start and finish times
- a short message and a log excerpt
- the AI tokens used

**Behaviour:**
- **Resume:** a run can be resumed after a restart or a closed browser, and a failed step can be retried.
- **Cancel:** cancelling cleans up: sandbox Jobs are deleted, and a repo that was already created is kept
  unless the user asks to delete it.
- **Live updates** go over Socket.io.
- **List page:** "My starter runs" with status, repository link and date.
- **Notifications:** optional, through the planned Slack/webhook connectors.

**Task tracker (optional):** create GitHub Issues or GitLab issues plus a milestone ("v0.1") for the
next steps the bot suggests (e.g. "Add authentication", "Set up staging").

---

## 8. AI provider connectors

**Connectors → AI providers**, same pattern as the other connectors: encrypted key, **Test**, default,
enable/disable.

| Provider | Connection | Notes |
|---|---|---|
| **OpenAI (ChatGPT)** | API key, optional org/project; base `https://api.openai.com/v1` | Model list from `/v1/models` |
| **Google Gemini** | API key; Generative Language API | Model list from the API |
| **Ollama** | Local `http://localhost:11434` (no key) **or Ollama Cloud** (`https://ollama.com`, API key) | Model list from `/api/tags`; local models are private and free but slower |
| **Anthropic Claude** | API key; `https://api.anthropic.com` | Strong at code generation and tool use; recommended for the generate/fix steps |
| **Azure OpenAI** | Endpoint, deployment, key | For company tenants |
| **OpenAI-compatible** | Base URL + key (OpenRouter, Groq, LM Studio, vLLM, LiteLLM) | One adapter covers many |

**Per connector:**
- default model (picked from the live model list, never hard-coded)
- temperature and max output tokens
- timeout
- a **monthly token/cost budget**
- which features may use it (Project Starter, Copilot)

**Test** sends a tiny prompt and reports latency and the model.

**AI gateway** (backend) has one interface for all providers:

```ts
chat({ messages, tools?, jsonSchema?, stream? }) → stream of text / tool calls / final JSON
```

**Gateway responsibilities:**
- **Normalization:** unifies streaming, tool calling and structured-JSON output across providers
  (with JSON-repair and retry for models without native schema support).
- **Models per task:** a fast, cheap model for the interview, and a strong code model for generation
  and fixes (configurable).
- **Usage tracking:** tokens and estimated cost per run and per user.
- **Limits:** rate limits and budget enforcement.
- **Fallback:** an optional fallback provider when one fails.

---

## 9. Safety and security

| Risk | Control |
|---|---|
| Secrets leaking to the AI | Never send tokens, `.env` values or connector data; redact with secret patterns before sending |
| Generated code doing harm | Runs only in the sandbox Job (no credentials, egress limited to registries, time and memory limits) |
| Malicious or typo packages | Registry checks, age/download thresholds, deprecation and OSV vulnerability checks |
| Prompt injection (from READMEs or templates) | Only the chat and curated templates go into prompts; tool calls are limited to the orchestrator's own actions |
| Pushing something unwanted | Mandatory **review + approve** before create/push; never overwrite a non-empty repo |
| Token scope too wide | Recommend fine-grained GitHub tokens limited to the target org; show missing and extra scopes |
| Cost runaway | Per-connector budgets, per-run token caps, a visible usage counter |
| Licensing | License chosen explicitly; generated `LICENSE` file; packages' licenses listed in the plan (npm `license` field) |
| Accountability | Audit log for AI connector changes, repo creation, pushes and approvals |

**Permissions:**
- only managers and users with a new **"Project Starter"** permission can run it
- only managers configure AI connectors
- repository creation checks the connector and owner

---

## 10. Data model and API (sketch)

```
AiConnector     { name, provider, baseUrl, apiKey(enc), defaultModel, models[], temperature, maxTokens,
                  budgetMonthly, usedThisMonth, features[], isDefault, isActive, status, lastError }
StarterRun      { owner, title, aiConnectorId, model, answers{}, plan{stack, packages[{name, version, source}], files[]},
                  steps[{key, state, startedAt, finishedAt, message, log}], repo{connectorId, host, owner, name, url},
                  usage{inputTokens, outputTokens, cost}, status, createdAt }
StarterFile     { runId, path, content, source: template|ai, version }   // or GridFS for large runs
```

```
GET/POST/PUT/DELETE /api/ai/connectors, POST /api/ai/connectors/:id/test, GET /api/ai/connectors/:id/models
POST /api/starter/runs                      start (idea + provider)
POST /api/starter/runs/:id/messages         chat turn (streamed)
POST /api/starter/runs/:id/plan/approve
GET  /api/starter/versions?ecosystem=npm&pkg=react
POST /api/starter/runs/:id/generate | /validate | /publish | /retry/:step | /cancel
GET  /api/starter/runs, GET /api/starter/runs/:id (+ files, logs)
GET  /api/git/:id/owners                    GitHub orgs / GitLab groups the token can create repos in
POST /api/git/:id/repos                     create (GitHub + GitLab)
POST /api/git/:id/repos/:repo/push          push a file set as one commit
```

---

## 11. Phases

| Phase | Deliverable | Size |
|---|---|---|
| **0 (done)** | GitHub connector + repository browser (token scopes, orgs, all repos) | ✅ |
| **1** | AI provider connectors (OpenAI, Gemini, Ollama local/cloud, Claude, OpenAI-compatible) + AI gateway + Test + usage/budget | M |
| **2** | Version resolver (npm, PyPI, Node LTS, Docker, OSV) + UI to try it | S |
| **3** | Starter chat: interview with defaults, plan JSON, plan review UI, run tracker (persisted, live) | M |
| **4** | Templates (react-vite-ts, express-ts, fastapi, fullstack) + AI generation with validated JSON output + file viewer | M |
| **5** | Sandbox validation Job (install/lint/build/test) + fix loop | M |
| **6** | Repo create + push for GitHub (new) and GitLab (reuse), branch protection, topics, CI variables checklist | M |
| **7** | Optional: starter issues/milestone, register as DevOps Intelligence project, org-repo approval, notifications | S |

Order matters: providers (1) → versions (2) → chat and tracker (3) give a usable "plan only" assistant
early. Generation, validation and publishing (4–6) build on it.

---

## 12. Decisions needed from you

1. **Which AI provider first?** Any mix of OpenAI, Gemini, Ollama local or cloud, and Claude. The
   gateway supports all of them, but the first one is built and tested end to end.
2. **Stacks for v1:** e.g. React + Vite (TS) and Node Express (TS), plus FastAPI. Fewer stacks means
   better templates.
3. **Repo host for v1:** GitHub, GitLab or both.
4. **Who may use it:** managers only, or developers with a new permission.
5. **Sandbox location:** your minikube (tight on memory) or a separate runner (Docker on the host, or
   a CI job in the target repo).
