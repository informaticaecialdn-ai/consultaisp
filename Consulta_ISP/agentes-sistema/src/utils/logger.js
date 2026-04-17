// Logger leve com correlationId. Sprint 3 / T1 substituira por pino.
// API compativel com pino (info/warn/error/fatal/debug) para facilitar swap.

function format(level, corr, payload, msg) {
  const ts = new Date().toISOString();
  const tag = corr ? `[${corr}]` : '';
  let details = '';
  if (payload && typeof payload === 'object') {
    try { details = ' ' + JSON.stringify(payload); } catch { details = ''; }
  }
  return `${ts} ${level.toUpperCase()} ${tag} ${msg || ''}${details}`.trim();
}

function makeLogger(correlation) {
  const call = (fn, level) => (objOrMsg, maybeMsg) => {
    if (typeof objOrMsg === 'string') {
      fn(format(level, correlation, null, objOrMsg));
    } else {
      fn(format(level, correlation, objOrMsg, maybeMsg));
    }
  };
  return {
    info: call(console.log, 'info'),
    warn: call(console.warn, 'warn'),
    error: call(console.error, 'error'),
    fatal: call(console.error, 'fatal'),
    debug: call(console.log, 'debug'),
    withCorrelation(id) { return makeLogger(id); }
  };
}

const root = makeLogger(null);
module.exports = root;
