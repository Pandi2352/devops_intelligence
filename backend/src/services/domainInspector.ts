import axios from 'axios';
import tls from 'node:tls';

// What the internet sees for a hostname: DNS answers (via DNS-over-HTTPS, so the server's own resolver
// does not matter), whether HTTPS answers, and the TLS certificate. Needs no Cloudflare permission.

export interface HostInspection {
  hostname: string;
  dns: { A: string[]; AAAA: string[]; CNAME: string[]; error: string };
  https: { ok: boolean; status: number; ms: number; server: string; location: string; viaCloudflare: boolean; poweredBy: string; error: string };
  tls: { ok: boolean; valid: boolean; issuer: string; subject: string; validTo: string; daysLeft: number | null; altNames: string[]; error: string };
}

const TYPES: Record<number, 'A' | 'AAAA' | 'CNAME'> = { 1: 'A', 28: 'AAAA', 5: 'CNAME' };

const lookup = async (hostname: string) => {
  const out = { A: [] as string[], AAAA: [] as string[], CNAME: [] as string[], error: '' };
  try {
    const answers = await Promise.all(
      ['A', 'AAAA'].map((type) =>
        axios
          .get('https://cloudflare-dns.com/dns-query', { params: { name: hostname, type }, headers: { accept: 'application/dns-json' }, timeout: 5000 })
          .then((r) => r.data?.Answer || [])
      )
    );
    for (const a of answers.flat()) {
      const t = TYPES[a.type];
      const value = String(a.data).replace(/\.$/, '');
      if (t && !out[t].includes(value)) out[t].push(value);
    }
  } catch (err: any) {
    out.error = err?.code === 'ENOTFOUND' ? 'No internet access from the server' : err?.message || 'DNS lookup failed';
  }
  return out;
};

const probeHttps = async (hostname: string) => {
  const started = Date.now();
  try {
    const res = await axios.get(`https://${hostname}/`, {
      timeout: 8000,
      maxRedirects: 0,
      validateStatus: () => true,
      responseType: 'text',
      transformResponse: (d) => d,
      headers: { 'User-Agent': 'DevOps-Intelligence-check/1.0' },
    });
    const h = res.headers as Record<string, string>;
    const server = String(h.server || '');
    return {
      ok: true,
      status: res.status,
      ms: Date.now() - started,
      server,
      location: String(h.location || ''),
      viaCloudflare: Boolean(h['cf-ray']) || /cloudflare/i.test(server),
      poweredBy: String(h['x-powered-by'] || (h['x-vercel-id'] ? 'Vercel' : h['x-nf-request-id'] ? 'Netlify' : h['x-github-request-id'] ? 'GitHub Pages' : '')),
      error: '',
    };
  } catch (err: any) {
    const code = err?.code || '';
    const error = code === 'ENOTFOUND' ? 'Does not resolve' : code === 'ECONNREFUSED' ? 'Connection refused' : code === 'ECONNABORTED' || code === 'ETIMEDOUT' ? 'Timed out' : err?.message || 'Unreachable';
    return { ok: false, status: 0, ms: Date.now() - started, server: '', location: '', viaCloudflare: false, poweredBy: '', error };
  }
};

const probeTls = (hostname: string) =>
  new Promise<HostInspection['tls']>((resolve) => {
    const empty = { ok: false, valid: false, issuer: '', subject: '', validTo: '', daysLeft: null, altNames: [] as string[] };
    const socket = tls.connect({ host: hostname, port: 443, servername: hostname, rejectUnauthorized: false, timeout: 6000 }, () => {
      const cert = socket.getPeerCertificate();
      const validTo = cert?.valid_to ? new Date(cert.valid_to).toISOString() : '';
      resolve({
        ok: true,
        valid: socket.authorized,
        issuer: [cert?.issuer?.O, cert?.issuer?.CN].filter(Boolean).join(' · '),
        subject: String(cert?.subject?.CN || ''),
        validTo,
        daysLeft: validTo ? Math.floor((new Date(validTo).getTime() - Date.now()) / 86400_000) : null,
        altNames: String(cert?.subjectaltname || '')
          .split(',')
          .map((s) => s.trim().replace(/^DNS:/, ''))
          .filter(Boolean)
          .slice(0, 10),
        error: socket.authorized ? '' : String(socket.authorizationError || ''),
      });
      socket.end();
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve({ ...empty, error: 'Timed out' });
    });
    socket.on('error', (err: any) => resolve({ ...empty, error: err?.code === 'ENOTFOUND' ? 'Does not resolve' : err?.message || 'TLS failed' }));
  });

export const inspectHost = async (hostname: string): Promise<HostInspection> => {
  const [dns, https, cert] = await Promise.all([lookup(hostname), probeHttps(hostname), probeTls(hostname)]);
  return { hostname, dns, https, tls: cert };
};
