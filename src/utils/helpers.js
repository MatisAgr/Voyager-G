/**
 * helpers.js - General-purpose utility functions.
 *
 * Shared helpers are placed here to avoid duplication across modules.
 * Each function should be pure (no side-effects, no bot/state dependency)
 * so it remains easy to unit-test.
 */

/**
 * Returns a promise that resolves after the given number of milliseconds.
 * Useful for adding delays between retries or game-tick waits.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Truncates a string to the specified length, appending "..." if trimmed.
 * Handy for keeping LLM context windows within token limits.
 */
function truncate(text, maxLength = 500) {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

/**
 * Safely serializes an object to a JSON string.
 * Returns a fallback string on circular-reference errors.
 */
function safeStringify(obj) {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return "[Unserializable object]";
  }
}

module.exports = {
  sleep,
  truncate,
  safeStringify,
};
