import axios from 'axios';

// Latest stable versions straight from the package registries, so generated projects never rely on
// the AI's memory. Public endpoints, no keys. Results are cached for an hour.

export type Ecosystem = 'npm' | 'pypi' | 'go' | 'maven' | 'nuget' | 'rubygems' | 'crates' | 'packagist' | 'pub' | 'docker' | 'runtime';
export const ECOSYSTEMS: Ecosystem[] = ['npm', 'pypi', 'go', 'maven', 'nuget', 'rubygems', 'crates', 'packagist', 'pub', 'docker', 'runtime'];

export interface VersionInfo {
  ecosystem: Ecosystem;
  name: string;
  found: boolean;
  latest: string;
  released?: string;
  deprecated?: string;
  notes?: string; // engines, python requirement, LTS, …
  source: string;
}

const UA = { 'User-Agent': 'DevOps-Intelligence-Project-Starter/1.0 (version lookup)' };
const get = (url: string, params?: Record<string, unknown>) => axios.get(url, { params, headers: UA, timeout: 12000 });
const PRE = /(-|\.)(alpha|beta|rc|pre|preview|canary|next|dev|snapshot|m\d)/i;
const stable = (v: string) => Boolean(v) && !PRE.test(v) && !/[a-z]/i.test(v.replace(/^v/, '').split(/[-+]/)[0]);

const cmp = (a: string, b: string) => {
  const pa = a.replace(/^v/, '').split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.replace(/^v/, '').split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
};
const newestStable = (versions: string[]) => versions.filter(stable).sort(cmp).pop() || '';

const cache = new Map<string, { at: number; v: VersionInfo }>();

const resolvers: Record<Ecosystem, (name: string) => Promise<Omit<VersionInfo, 'ecosystem' | 'name'>>> = {
  npm: async (name) => {
    const r = await get(`https://registry.npmjs.org/${name.replace('/', '%2F')}`);
    const latest = r.data['dist-tags']?.latest || '';
    const meta = r.data.versions?.[latest] || {};
    const engines = meta.engines ? `engines ${JSON.stringify(meta.engines)}` : '';
    const peers = meta.peerDependencies ? `peers ${Object.entries(meta.peerDependencies).map(([k, v]) => `${k}@${v}`).join(', ')}` : '';
    return { found: true, latest, released: r.data.time?.[latest], deprecated: meta.deprecated || undefined, notes: [engines, peers].filter(Boolean).join('; ') || undefined, source: 'registry.npmjs.org' };
  },
  pypi: async (name) => {
    const r = await get(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`);
    const versions = Object.keys(r.data.releases || {}).filter((v) => (r.data.releases[v] || []).length && !(r.data.releases[v] || []).every((f: any) => f.yanked));
    const latest = newestStable(versions) || r.data.info?.version || '';
    const file = (r.data.releases?.[latest] || [])[0];
    return { found: true, latest, released: file?.upload_time_iso_8601, notes: r.data.info?.requires_python ? `requires python ${r.data.info.requires_python}` : undefined, source: 'pypi.org' };
  },
  go: async (name) => {
    const r = await get(`https://proxy.golang.org/${name.toLowerCase().replace(/[A-Z]/g, (c) => `!${c.toLowerCase()}`)}/@latest`);
    return { found: true, latest: r.data.Version, released: r.data.Time, source: 'proxy.golang.org' };
  },
  maven: async (name) => {
    // "group:artifact"
    const [g, a] = name.split(':');
    if (!g || !a) throw new Error('Maven packages are "groupId:artifactId", e.g. org.springframework.boot:spring-boot-starter-web');
    const r = await get('https://search.maven.org/solrsearch/select', { q: `g:"${g}" AND a:"${a}"`, core: 'gav', rows: 50, wt: 'json' });
    const docs = r.data.response?.docs || [];
    const latest = newestStable(docs.map((d: any) => d.v));
    const doc = docs.find((d: any) => d.v === latest);
    return { found: Boolean(latest), latest, released: doc?.timestamp ? new Date(doc.timestamp).toISOString() : undefined, source: 'search.maven.org' };
  },
  nuget: async (name) => {
    const r = await get(`https://api.nuget.org/v3-flatcontainer/${name.toLowerCase()}/index.json`);
    return { found: true, latest: newestStable(r.data.versions || []), source: 'api.nuget.org' };
  },
  rubygems: async (name) => {
    const r = await get(`https://rubygems.org/api/v1/versions/${encodeURIComponent(name)}.json`);
    const v = (r.data || []).find((x: any) => !x.prerelease);
    return { found: Boolean(v), latest: v?.number || '', released: v?.created_at, notes: v?.ruby_version ? `requires ruby ${v.ruby_version}` : undefined, source: 'rubygems.org' };
  },
  crates: async (name) => {
    const r = await get(`https://crates.io/api/v1/crates/${encodeURIComponent(name)}`);
    return { found: true, latest: r.data.crate?.max_stable_version || r.data.crate?.max_version, released: r.data.crate?.updated_at, source: 'crates.io' };
  },
  packagist: async (name) => {
    const r = await get(`https://repo.packagist.org/p2/${name}.json`);
    const list = r.data.packages?.[name] || [];
    const latest = newestStable(list.map((p: any) => p.version_normalized ? p.version : p.version));
    const p = list.find((x: any) => x.version === latest);
    return { found: Boolean(latest), latest: latest.replace(/^v/, ''), released: p?.time, notes: p?.require?.php ? `requires php ${p.require.php}` : undefined, source: 'packagist.org' };
  },
  pub: async (name) => {
    const r = await get(`https://pub.dev/api/packages/${encodeURIComponent(name)}`);
    return { found: true, latest: r.data.latest?.version, released: r.data.latest?.published, notes: r.data.latest?.pubspec?.environment?.sdk ? `sdk ${r.data.latest.pubspec.environment.sdk}` : undefined, source: 'pub.dev' };
  },
  docker: async (name) => {
    // Official images: "node", "python"; others: "bitnami/postgresql". Returns the newest plain version tag.
    const repo = name.includes('/') ? name : `library/${name}`;
    const r = await get(`https://hub.docker.com/v2/repositories/${repo}/tags`, { page_size: 100, ordering: 'last_updated' });
    const tags: string[] = (r.data.results || []).map((t: any) => t.name);
    const plain = tags.filter((t) => /^\d+(\.\d+){0,2}$/.test(t));
    const latest = plain.sort(cmp).pop() || '';
    const variants = tags.filter((t) => latest && t.startsWith(`${latest}-`)).slice(0, 6);
    return { found: Boolean(latest), latest, notes: variants.length ? `variants: ${variants.join(', ')}` : undefined, source: 'hub.docker.com' };
  },
  runtime: async (name) => {
    // endoflife.date product names: nodejs, python, go, java (eclipse-temurin), dotnet, php, ruby, rust, kotlin, flutter, postgresql, mongodb, mysql, redis …
    const r = await get(`https://endoflife.date/api/${encodeURIComponent(name.toLowerCase())}.json`);
    const cycles: any[] = r.data || [];
    const supported = cycles.filter((c) => c.eol === false || (typeof c.eol === 'string' && new Date(c.eol) > new Date()));
    const lts = supported.find((c) => c.lts === true || (typeof c.lts === 'string' && new Date(c.lts) <= new Date()));
    const latest = supported[0] || cycles[0];
    return {
      found: Boolean(latest),
      latest: latest?.latest || latest?.cycle || '',
      released: latest?.latestReleaseDate || latest?.releaseDate,
      notes: [lts ? `current LTS ${lts.latest || lts.cycle}` : '', latest?.eol && latest.eol !== false ? `EOL ${latest.eol}` : ''].filter(Boolean).join('; ') || undefined,
      source: 'endoflife.date',
    };
  },
};

export const resolveVersion = async (ecosystem: Ecosystem, name: string): Promise<VersionInfo> => {
  const key = `${ecosystem}:${name.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 3600_000) return hit.v;
  let v: VersionInfo;
  try {
    if (!ECOSYSTEMS.includes(ecosystem)) throw new Error(`Unknown ecosystem ${ecosystem}`);
    v = { ecosystem, name, ...(await resolvers[ecosystem](name.trim())) };
  } catch (err: any) {
    v = { ecosystem, name, found: false, latest: '', source: '', notes: err?.response?.status === 404 ? 'Package not found in the registry (check the exact name)' : err?.message || 'Lookup failed' };
  }
  cache.set(key, { at: Date.now(), v });
  return v;
};

export const resolveMany = (items: { ecosystem: Ecosystem; name: string }[]) => Promise.all(items.slice(0, 40).map((i) => resolveVersion(i.ecosystem, i.name)));
