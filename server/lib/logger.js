/**
 * Tiny leveled logger with timestamps and a component tag.
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[process.env.LOG_LEVEL] || LEVELS.info;
const role = process.env.ZM_ROLE || 'app';

function log(level, tag, args) {
  if (LEVELS[level] < threshold) return;
  const ts = new Date().toISOString();
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(`${ts} ${level.toUpperCase().padEnd(5)} [${role}:${tag}]`, ...args);
}

/**
 * @param {string} tag  Component name shown in every line.
 */
module.exports = function createLogger(tag) {
  return {
    debug: (...a) => log('debug', tag, a),
    info: (...a) => log('info', tag, a),
    warn: (...a) => log('warn', tag, a),
    error: (...a) => log('error', tag, a),
  };
};
