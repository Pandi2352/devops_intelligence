// End-to-end check of the AI Project Starter with fake OpenAI, GitHub (Enterprise API) and GitLab servers on
// localhost. Version lookups go to the real package registries. Everything created is removed at the end.
//   node dist/scripts/testStarter.js
import http from 'node:http';

const API = process.env.API_URL || 'http://localhost:5000/api';
const KEY = 'sk-test-starter-0123456789';
const GH_TOKEN = 'ghp_teststarter0000000000000000000000000';
const GL_TOKEN = 'glpat-teststarter000000000';

// ---------------------------------------------------------------- fakes

const gh = { repos: new Map<string, any>(), trees: new Map<string, any[]>(), commits: 0 };
const gl = { projects: new Map<string, any>(), commits: [] as any[] };
const seen = { planToolCall: false, interviewToolCall: false, planRounds: 0, planForced: false };

const json = (res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};

const openaiReply = (body: any) => {
  const msgs: any[] = body.messages || [];
  const last = msgs[msgs.length - 1];
  const system = String(msgs[0]?.content || '');
  const schema = body.response_format?.json_schema?.name;
  const toolCall = (name: string, args: unknown) => ({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id: `call_${Math.random().toString(36).slice(2)}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }], usage: { prompt_tokens: 50, completion_tokens: 10 } });
  const answer = (content: string) => ({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }], usage: { prompt_tokens: 100, completion_tokens: 40 } });

  if (schema === 'project_plan') {
    // A stubborn model (like the gpt-4o-mini case): keeps calling tools until tools are forbidden.
    if (body.tool_choice !== 'none') {
      seen.planToolCall = true;
      seen.planRounds += 1;
      return toolCall('lookup_latest_versions', { packages: [{ ecosystem: 'npm', name: 'vite' }] });
    }
    seen.planForced = true;
    const toolMsgs = msgs.filter((x: any) => x.role === 'tool');
    const vite = JSON.parse(toolMsgs[toolMsgs.length - 1].content)[0];
    return answer(
      JSON.stringify({
        name: 'todo-app',
        summary: 'A small todo app',
        stack: [{ name: 'vite', ecosystem: 'npm', version: vite.latest, purpose: 'dev server' }],
        files: [
          { path: 'README.md', purpose: 'docs' },
          { path: 'package.json', purpose: 'manifest' },
          { path: 'src/main.js', purpose: 'entry' },
          { path: '../evil.sh', purpose: 'must be dropped' },
          { path: '.git/config', purpose: 'must be dropped' },
          { path: 'package-lock.json', purpose: 'must be dropped' },
        ],
        setupInstructions: 'npm install && npm run dev',
      })
    );
  }
  if (schema === 'project_files') {
    const wanted = String(last.content).split('Write these files now:')[1] || '';
    const paths = [...wanted.matchAll(/^- ([^:]+):/gm)].map((m) => m[1].trim());
    return answer(JSON.stringify({ files: [...paths.map((p) => ({ path: p, content: `// ${p}\n` })), { path: 'not/requested.txt', content: 'x' }] }));
  }
  if (system.startsWith('You are the Project Starter')) {
    if (last.role !== 'tool') {
      seen.interviewToolCall = true;
      return toolCall('lookup_latest_version', { ecosystem: 'npm', name: 'react' });
    }
    return answer(`React ${JSON.parse(last.content).latest} it is. Anything else? Otherwise press **Generate project**.`);
  }
  return answer('ready');
};

const fake = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const url = new URL(req.url || '/', 'http://x');
    const p = url.pathname;
    const body = raw ? JSON.parse(raw) : {};
    let m: RegExpMatchArray | null;

    // OpenAI
    if (p.startsWith('/v1/')) {
      if (req.headers.authorization !== `Bearer ${KEY}`) return json(res, 401, { error: { message: 'Incorrect API key provided' } });
      if (p === '/v1/models') return json(res, 200, { data: [{ id: 'gpt-test-1' }, { id: 'text-embedding-3-small' }, { id: 'gpt-test-mini' }] });
      if (p === '/v1/chat/completions') return json(res, 200, openaiReply(body));
    }
    // GitHub Enterprise API
    if (p.startsWith('/api/v3/')) {
      if (req.headers.authorization !== `token ${GH_TOKEN}` && req.headers.authorization !== `Bearer ${GH_TOKEN}`) return json(res, 401, { message: 'Bad credentials' });
      const q = p.slice('/api/v3'.length);
      if (q === '/user') return json(res, 200, { login: 'tester', name: 'Test User' }, { 'x-oauth-scopes': 'repo, workflow' });
      if (q === '/user/orgs') return json(res, 200, []);
      if (q === '/user/repos' && req.method === 'POST') {
        const r = { name: body.name, full_name: `tester/${body.name}`, owner: { login: 'tester' }, html_url: `http://gh.test/tester/${body.name}`, clone_url: `http://gh.test/tester/${body.name}.git`, default_branch: 'main', private: body.private };
        gh.repos.set(r.full_name, r);
        return json(res, 201, r);
      }
      if ((m = q.match(/^\/repos\/([^/]+)\/([^/]+)$/))) return gh.repos.has(`${m[1]}/${m[2]}`) ? json(res, 200, gh.repos.get(`${m[1]}/${m[2]}`)) : json(res, 404, { message: 'Not Found' });
      if (/\/git\/ref\/heads(%2F|\/)main$/i.test(q)) return json(res, 200, { object: { sha: 'initsha' } });
      if (q.endsWith('/git/blobs')) return json(res, 201, { sha: `blob${Math.random().toString(36).slice(2)}` });
      if (q.endsWith('/git/trees')) {
        const sha = `tree${gh.trees.size}`;
        gh.trees.set(sha, body.tree);
        return json(res, 201, { sha });
      }
      if (q.endsWith('/git/commits')) return json(res, 201, { sha: `commit000${++gh.commits}abcdef` });
      if (/\/git\/refs\/heads(%2F|\/)main$/i.test(q)) return json(res, 200, { object: { sha: 'x' } });
    }
    // GitLab API
    if (p.startsWith('/api/v4/')) {
      if (req.headers['private-token'] !== GL_TOKEN) return json(res, 401, { message: '401 Unauthorized' });
      const q = p.slice('/api/v4'.length);
      if (q === '/user') return json(res, 200, { username: 'gltester', namespace_id: 7 });
      if (q === '/groups') return json(res, 200, [{ id: 42, full_path: 'acme/team' }]);
      if (q === '/projects' && req.method === 'POST') {
        const path = body.namespace_id === 42 ? `acme/team/${body.path}` : `gltester/${body.path}`;
        const proj = { id: gl.projects.size + 100, web_url: `http://gl.test/${path}`, path_with_namespace: path, http_url_to_repo: `http://gl.test/${path}.git`, default_branch: 'main' };
        gl.projects.set(path, proj);
        return json(res, 201, proj);
      }
      if ((m = q.match(/^\/projects\/(\d+)\/repository\/commits$/))) {
        gl.commits.push(body);
        return json(res, 201, { id: 'abcdef1234567890', short_id: 'abcdef12' });
      }
      if ((m = q.match(/^\/projects\/(.+)$/)) && req.method === 'GET') {
        const path = decodeURIComponent(m[1]);
        return gl.projects.has(path) ? json(res, 200, gl.projects.get(path)) : json(res, 404, { message: '404 Project Not Found' });
      }
    }
    json(res, 404, { message: `fake: no route ${req.method} ${p}` });
  });
});

// ---------------------------------------------------------------- helpers

const login = async (email: string, password: string) =>
  ((await (await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })).json()) as any).token as string;
const call = async (token: string, method: string, path: string, body?: unknown) => {
  const r = await fetch(`${API}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  let data: any = null;
  try {
    data = await r.json();
  } catch {
    /* empty */
  }
  return { status: r.status, data };
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (token: string, id: string, until: (run: any) => boolean, seconds = 90) => {
  let run: any = null;
  for (let i = 0; i < seconds; i++) {
    run = (await call(token, 'GET', `/starter/runs/${id}`)).data?.run;
    if (run && until(run)) break;
    await sleep(1000);
  }
  return run;
};

const main = async () => {
  await new Promise<void>((r) => fake.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(fake.address() as any).port}`;
  let pass = 0;
  const fails: string[] = [];
  const check = (label: string, cond: boolean, detail = '') => (cond ? (pass += 1) : fails.push(`${label}${detail ? ` (${detail})` : ''}`));

  const admin = await login('test.admin@devops.local', 'Admin-Test-2026');
  const erin = await login('lead.erin@devops.local', 'Erin-Test-2026');
  const created: { ai?: string; gh?: string; gl?: string; runs: string[] } = { runs: [] };

  try {
    // 1. AI connector
    check('non-managers cannot see AI connectors', (await call(erin, 'GET', '/ai/connectors')).status === 403);
    check('non-managers cannot use the Project Starter', (await call(erin, 'GET', '/starter/runs')).status === 403);
    const bad = await call(admin, 'POST', '/ai/connectors/test', { provider: 'openai-compatible', baseUrl: `${base}/v1`, apiKey: 'sk-wrong' });
    check('wrong key is reported', bad.data?.ok === false && /401|rejected/.test(bad.data?.message || ''), bad.data?.message);
    const t = await call(admin, 'POST', '/ai/connectors/test', { provider: 'openai-compatible', baseUrl: `${base}/v1`, apiKey: KEY });
    check('test lists models', t.data?.ok === true && t.data?.models?.includes('gpt-test-1'), t.data?.message);
    const ai = await call(admin, 'POST', '/ai/connectors', { name: '__starter-test-ai', provider: 'openai-compatible', baseUrl: `${base}/v1`, apiKey: KEY, defaultModel: 'gpt-test-1' });
    created.ai = ai.data?.connector?._id;
    check('AI connector saved and model answered', ai.status === 201 && ai.data?.test?.ok === true && /answered/.test(ai.data?.test?.message || ''), ai.data?.test?.message);
    check('API key never returned', ai.data?.connector && !('apiKey' in ai.data.connector) && /^••••/.test(ai.data.connector.keyHint));

    // 2. chat with a real version lookup
    const run = await call(admin, 'POST', '/starter/runs', { connectorId: created.ai, message: 'A todo app with React' });
    const id = run.data?.run?._id;
    if (id) created.runs.push(id);
    const reply = run.data?.run?.messages?.[1];
    check('AI answered the first message', run.status === 201 && reply?.role === 'assistant', JSON.stringify(run.data?.message));
    check('answer used the registry lookup (react)', seen.interviewToolCall && reply?.versions?.[0]?.name === 'react' && /^\d+\.\d+\.\d+/.test(reply?.versions?.[0]?.latest || ''), JSON.stringify(reply?.versions));

    // 3. generate
    const g = await call(admin, 'POST', `/starter/runs/${id}/generate`);
    check('generate accepted (202)', g.status === 202);
    const done = await waitFor(admin, id, (r) => r.status !== 'generating');
    check('generation finished', done?.status === 'ready', `${done?.status}: ${done?.error}`);
    check('a model that never stops calling tools is forced to answer', seen.planForced && seen.planRounds >= 3, `rounds ${seen.planRounds}`);
    check('plan versions come from the registry', seen.planToolCall && /^\d+\.\d+\.\d+/.test(done?.plan?.stack?.[0]?.version || ''), JSON.stringify(done?.plan?.stack));
    const paths = (done?.files || []).map((f: any) => f.path).sort();
    check('unsafe paths, lock files and unrequested files dropped', JSON.stringify(paths) === JSON.stringify(['README.md', 'package.json', 'src/main.js']), JSON.stringify(paths));
    check('tracker steps done', ['interview', 'plan', 'files'].every((k) => done?.steps?.find((s: any) => s.key === k)?.state === 'done'));

    // 4. review edits
    const edit = await call(admin, 'PUT', `/starter/runs/${id}/files`, { path: 'src/app.js', content: 'export const x = 1;\n' });
    check('add a file during review', edit.status === 200 && edit.data?.run?.files?.some((f: any) => f.path === 'src/app.js'));
    check('path traversal refused', (await call(admin, 'PUT', `/starter/runs/${id}/files`, { path: '../x', content: '' })).status === 400);

    // 5. push to GitHub (Enterprise-style API on the fake server)
    const ghc = await call(admin, 'POST', '/git', { name: '__starter-test-gh', provider: 'github', baseUrl: base, token: GH_TOKEN });
    created.gh = ghc.data?.connector?._id || ghc.data?.integration?._id;
    check('GitHub connector saved', ghc.status === 201 && Boolean(created.gh), ghc.data?.message);
    const owners = await call(admin, 'GET', `/starter/owners?connectorId=${created.gh}`);
    check('owners listed', owners.data?.owners?.[0]?.id === 'tester', JSON.stringify(owners.data));
    const pub = await call(admin, 'POST', `/starter/runs/${id}/publish`, { gitConnectorId: created.gh, owner: 'tester', ownerName: 'tester', name: 'todo-app', visibility: 'private' });
    check('publish accepted (202)', pub.status === 202, pub.data?.message);
    const published = await waitFor(admin, id, (r) => r.status !== 'publishing');
    check('pushed to GitHub', published?.status === 'published' && published?.repo?.url === 'http://gh.test/tester/todo-app', `${published?.status}: ${published?.error}`);
    const tree = [...gh.trees.values()][0] || [];
    check('commit contains exactly the project files', JSON.stringify(tree.map((x: any) => x.path).sort()) === JSON.stringify(['README.md', 'package.json', 'src/app.js', 'src/main.js']), JSON.stringify(tree.map((x: any) => x.path)));
    check('push steps done', ['create-repo', 'upload', 'commit'].every((k) => published?.steps?.find((s: any) => s.key === k)?.state === 'done'));

    // 6. existing repository is never overwritten
    const run2 = await call(admin, 'POST', '/starter/runs', { connectorId: created.ai, message: 'Another app' });
    const id2 = run2.data?.run?._id;
    if (id2) created.runs.push(id2);
    await call(admin, 'POST', `/starter/runs/${id2}/generate`);
    await waitFor(admin, id2, (r) => r.status !== 'generating');
    const dup = await call(admin, 'POST', `/starter/runs/${id2}/publish`, { gitConnectorId: created.gh, owner: 'tester', ownerName: 'tester', name: 'todo-app', visibility: 'private' });
    check('existing repository refused (409)', dup.status === 409, dup.data?.message);

    // 7. push to GitLab into a group
    const glc = await call(admin, 'POST', '/git', { name: '__starter-test-gl', provider: 'gitlab', baseUrl: base, token: GL_TOKEN });
    created.gl = glc.data?.connector?._id || glc.data?.integration?._id;
    const glOwners = await call(admin, 'GET', `/starter/owners?connectorId=${created.gl}`);
    check('GitLab owners include groups', glOwners.data?.owners?.some((o: any) => o.id === '42' && o.name === 'acme/team'), JSON.stringify(glOwners.data));
    const pub2 = await call(admin, 'POST', `/starter/runs/${id2}/publish`, { gitConnectorId: created.gl, owner: '42', ownerName: 'acme/team', name: 'other-app', visibility: 'internal' });
    check('GitLab publish accepted', pub2.status === 202, pub2.data?.message);
    const p2 = await waitFor(admin, id2, (r) => r.status !== 'publishing');
    check('pushed to GitLab group', p2?.status === 'published' && p2?.repo?.fullName === 'acme/team/other-app', `${p2?.status}: ${p2?.error}`);
    check('GitLab commit has create actions for every file', gl.commits[0]?.actions?.length === p2?.files?.length && gl.commits[0]?.actions?.every((a: any) => a.action === 'create'));

    // 8. usage recorded
    const list = (await call(admin, 'GET', '/ai/connectors')).data?.connectors || [];
    check('token usage recorded on the connector', (list.find((c: any) => c._id === created.ai)?.usage?.requests || 0) > 3);
    const v = await call(admin, 'GET', '/starter/versions?ecosystem=pypi&name=fastapi');
    check('version lookup (PyPI fastapi)', v.data?.found === true && /^\d+\.\d+/.test(v.data?.latest || ''), JSON.stringify(v.data));
  } finally {
    for (const r of created.runs) await call(admin, 'DELETE', `/starter/runs/${r}`);
    if (created.gh) await call(admin, 'DELETE', `/git/${created.gh}`);
    if (created.gl) await call(admin, 'DELETE', `/git/${created.gl}`);
    if (created.ai) await call(admin, 'DELETE', `/ai/connectors/${created.ai}`);
    fake.close();
  }
  console.log(`\nRESULT: ${pass} passed, ${fails.length} failed`);
  for (const f of fails) console.log(`  ✗ ${f}`);
  process.exit(fails.length ? 1 : 0);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
