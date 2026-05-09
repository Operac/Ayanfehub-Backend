type Level = 'INFO' | 'WARN' | 'ERROR';

function log(level: Level, message: string, meta?: Record<string, unknown>) {
  const ts = new Date().toISOString();
  const base = `[${ts}] [${level}] ${message}`;
  if (meta && Object.keys(meta).length) {
    console[level === 'ERROR' ? 'error' : level === 'WARN' ? 'warn' : 'log'](base, JSON.stringify(meta));
  } else {
    console[level === 'ERROR' ? 'error' : level === 'WARN' ? 'warn' : 'log'](base);
  }
}

const logger = {
  info:  (msg: string, meta?: Record<string, unknown>) => log('INFO',  msg, meta),
  warn:  (msg: string, meta?: Record<string, unknown>) => log('WARN',  msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => log('ERROR', msg, meta),
};

export default logger;
