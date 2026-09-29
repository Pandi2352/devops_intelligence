import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// Starter code that DevOps Intelligence can push into a new or existing repository.
// Each immediate sub-folder of the templates directory is one template (e.g. devops-demo/demo-api).
// Folders starting with "_" or "." are ignored (e.g. devops-demo/_reference).
const TEMPLATES_DIR = path.resolve(process.env.WORKSPACE_TEMPLATES_DIR || path.join(process.cwd(), '..', 'devops-demo'));

const ALWAYS_SKIP = new Set(['node_modules', '.git', '.DS_Store']);
const MAX_FILES = 500;
const MAX_TOTAL_BYTES = 5 * 1024 * 1024;

export interface TemplateFile {
  path: string; // posix path relative to the template root
  content: Buffer;
  blobSha: string; // git blob id, comparable with GitLab tree entry ids
}

export interface TemplateSummary {
  name: string;
  description: string;
  fileCount: number;
  totalBytes: number;
  hasPipeline: boolean;
}

// Minimal .gitignore support: "name", "dir/", "*.ext", "/rooted" patterns.
const loadIgnore = (root: string) => {
  const file = path.join(root, '.gitignore');
  const patterns = fs.existsSync(file)
    ? fs.readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !l.startsWith('!'))
    : [];
  return (relPath: string, isDir: boolean) => {
    const base = relPath.split('/').pop() || relPath;
    return patterns.some((raw) => {
      const dirOnly = raw.endsWith('/');
      const rooted = raw.startsWith('/');
      const p = raw.replace(/^\//, '').replace(/\/$/, '');
      if (dirOnly && !isDir) return false;
      if (p.includes('*')) {
        const re = new RegExp(`^${p.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
        return re.test(rooted ? relPath : base);
      }
      return rooted || p.includes('/') ? relPath === p : base === p;
    });
  };
};

const gitBlobSha = (content: Buffer) =>
  crypto.createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex');

export const listTemplates = (): TemplateSummary[] => {
  if (!fs.existsSync(TEMPLATES_DIR)) return [];
  return fs
    .readdirSync(TEMPLATES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.'))
    .map((d) => {
      const files = readTemplateFiles(d.name);
      let description = '';
      const pkgPath = path.join(TEMPLATES_DIR, d.name, 'package.json');
      if (fs.existsSync(pkgPath)) {
        try {
          description = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).description || '';
        } catch {
          description = '';
        }
      }
      return {
        name: d.name,
        description,
        fileCount: files.length,
        totalBytes: files.reduce((sum, f) => sum + f.content.length, 0),
        hasPipeline: files.some((f) => f.path === '.gitlab-ci.yml'),
      };
    });
};

// Returns every file to commit for a template. The name must be one returned by listTemplates().
export const readTemplateFiles = (name: string): TemplateFile[] => {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) throw new Error('Invalid template name');
  const root = path.join(TEMPLATES_DIR, name);
  if (path.dirname(root) !== TEMPLATES_DIR || !fs.existsSync(root)) throw new Error(`Template '${name}' not found`);

  const ignored = loadIgnore(root);
  const files: TemplateFile[] = [];
  let totalBytes = 0;

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ALWAYS_SKIP.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      const rel = path.relative(root, abs).split(path.sep).join('/');
      if (ignored(rel, entry.isDirectory())) continue;
      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.isFile()) {
        const content = fs.readFileSync(abs);
        totalBytes += content.length;
        if (files.length >= MAX_FILES || totalBytes > MAX_TOTAL_BYTES) {
          throw new Error(`Template '${name}' is too large (limit ${MAX_FILES} files / 5 MB)`);
        }
        files.push({ path: rel, content, blobSha: gitBlobSha(content) });
      }
    }
  };
  walk(root);
  return files.sort((a, b) => a.path.localeCompare(b.path));
};
