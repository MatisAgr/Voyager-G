/**
 * Embedding cache and semantic skill retrieval.
 * Stores skill vectors in state/skill-embeddings.json (persisted across runs).
 *
 * Uses asymmetric retrieval: task descriptions are embedded as RETRIEVAL_QUERY,
 * skill names as RETRIEVAL_DOCUMENT — different vectors, separate cache keys.
 */

const fs     = require("fs");
const path   = require("path");
const logger = require("../utils/logger");

const CACHE_PATH = path.resolve(process.env.STATE_DIR || "state", "skill-embeddings.json");

// In-memory mirror of the JSON cache.
// Keys: "d:<skillName>" for document embeddings.
// Query embeddings are NOT cached (tasks change every cycle).
let _cache = null;

function _load() {
  if (_cache) return _cache;
  try {
    _cache = JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8"));
  } catch {
    _cache = {};
  }
  return _cache;
}

function _persist() {
  try {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(_cache), "utf-8");
  } catch (err) {
    logger.warn("Embeddings", `Cache write failed: ${err.message}`);
  }
}

function _cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

/**
 * Returns the top-k skill names most semantically similar to the task.
 *
 * @param {string}   task          - Current task description.
 * @param {string[]} skillNames    - All available skill names.
 * @param {number}   k             - How many to return.
 * @param {Function} embedQueryFn  - async (text) => number[]  (RETRIEVAL_QUERY)
 * @param {Function} embedDocFn    - async (text) => number[]  (RETRIEVAL_DOCUMENT)
 */
async function retrieveByEmbedding(task, skillNames, k, embedQueryFn, embedDocFn) {
  if (skillNames.length <= k) return skillNames;

  const cache = _load();
  let dirty = false;

  // Embed the query (not cached — tasks are unique each cycle).
  let queryVec;
  try {
    queryVec = await embedQueryFn(task);
  } catch (err) {
    logger.warn("Embeddings", `Query embedding failed, using first-${k} fallback: ${err.message}`);
    return skillNames.slice(0, k);
  }

  const scored = [];
  for (const name of skillNames) {
    const key = `d:${name}`;
    let vec = cache[key];
    if (!vec) {
      try {
        vec = await embedDocFn(name.replace(/_/g, " "));
        cache[key] = vec;
        dirty = true;
      } catch {
        continue; // skip unembeddable skills rather than crashing
      }
    }
    scored.push({ name, score: _cosine(queryVec, vec) });
  }

  if (dirty) _persist();

  scored.sort((a, b) => b.score - a.score);
  logger.debug(
    "Embeddings",
    `Top-${k} for "${task}": ${scored.slice(0, k).map(s => `${s.name}(${s.score.toFixed(2)})`).join(", ")}`
  );
  return scored.slice(0, k).map(s => s.name);
}

/**
 * Pre-computes and caches the RETRIEVAL_DOCUMENT embedding for a new skill.
 * Fire-and-forget safe.
 */
async function indexSkillEmbedding(skillName, embedDocFn) {
  const cache = _load();
  const key = `d:${skillName}`;
  if (cache[key]) return;
  try {
    const vec = await embedDocFn(skillName.replace(/_/g, " "));
    cache[key] = vec;
    _persist();
    logger.debug("Embeddings", `Indexed "${skillName}"`);
  } catch (err) {
    logger.warn("Embeddings", `Failed to index "${skillName}": ${err.message}`);
  }
}

module.exports = { retrieveByEmbedding, indexSkillEmbedding };
