const TLS_ERRORS = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'CERT_HAS_EXPIRED',
]);

// Turns axios / fetch / Kubernetes client errors into a message a user can act on.
export const describeRequestError = (err: any, service: string): string => {
  const status: number | undefined =
    err?.response?.status ?? (typeof err?.code === 'number' ? err.code : undefined);
  const data = err?.response?.data;
  const apiMessage = typeof data === 'string' ? data : data?.message || data?.error;

  if (status === 401) return `${service} rejected the credentials (401 Unauthorized).`;
  if (status === 403) return `${service} denied access (403 Forbidden). Check the token scopes or RBAC permissions.`;
  if (status === 404) return `${service} endpoint not found (404). Check the server URL.`;
  if (status && status >= 400) {
    return `${service} responded with HTTP ${status}${apiMessage ? `: ${String(apiMessage).slice(0, 200)}` : ''}`;
  }

  const code = typeof err?.code === 'string' ? err.code : err?.cause?.code;
  if (code === 'ECONNREFUSED') return `Connection refused. Is ${service} running and reachable at that address?`;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'Host not found. Check the server URL.';
  if (code === 'ETIMEDOUT' || code === 'ECONNABORTED' || code === 'UND_ERR_CONNECT_TIMEOUT') {
    return `Connection to ${service} timed out.`;
  }
  if (code === 'ECONNRESET') return `${service} closed the connection unexpectedly.`;
  if (code === 'EPROTO' || /wrong version number/i.test(err?.message || '')) {
    return `The server at that address did not answer with TLS. If it serves plain HTTP use an http:// URL, and check it really is ${service}.`;
  }
  if (code && TLS_ERRORS.has(code)) {
    return 'TLS certificate could not be verified. Enable "Skip TLS verification" for self-signed certificates.';
  }

  const message: string = err?.message || 'Unknown error';
  return message.length > 300 ? `${message.slice(0, 300)}…` : message;
};

export const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error(`${label} timed out after ${ms / 1000}s`), { code: 'ETIMEDOUT' })), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
