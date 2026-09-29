// One JSON object per line on stdout: what `kubectl logs`, KubeOrbit's Logs tab and Loki expect.
const write = (level, message, fields = {}) => {
  if (process.env.NODE_ENV === 'test' && level !== 'error') return;
  process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), level, message, ...fields })}\n`);
};

export const logger = {
  info: (message, fields) => write('info', message, fields),
  warn: (message, fields) => write('warn', message, fields),
  error: (message, fields) => write('error', message, fields),
};
