/**
 * Lightweight console logger.
 * Prints timestamped messages with log levels.
 */

const LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

/** Prints one log line if level >= LOG_LEVEL. */
function log(level, tag, message) {
  if (LEVELS[level] < currentLevel) return;

  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}] [${tag}]`;

  switch (level) {
    case "debug":
      console.debug(`${prefix} ${message}`);
      break;
    case "info":
      console.info(`${prefix} ${message}`);
      break;
    case "warn":
      console.warn(`${prefix} ${message}`);
      break;
    case "error":
      console.error(`${prefix} ${message}`);
      break;
    default:
      console.log(`${prefix} ${message}`);
  }
}

module.exports = {
  debug: (tag, msg) => log("debug", tag, msg),
  info: (tag, msg) => log("info", tag, msg),
  warn: (tag, msg) => log("warn", tag, msg),
  error: (tag, msg) => log("error", tag, msg),
};
