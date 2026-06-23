/**
 * Skill retrieval.
 * Uses semantic embeddings (Gemini text-embedding-004) to find the top-K most
 * relevant skills for a given task.  Falls back to keyword overlap if the
 * embedding API is unavailable.
 */

const logger = require("../utils/logger");
const { retrieveByEmbedding } = require("./embeddings");
const { embedQuery, embedDocument } = require("../brain/gemini");

const TOPK = parseInt(process.env.SKILL_RETRIEVAL_TOPK, 10) || 12;

// Keyword fallback

function tokenize(s) {
  return new Set(
    String(s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  );
}

function overlapScore(taskTokens, name) {
  let shared = 0;
  for (const t of tokenize(name)) {
    if (taskTokens.has(t)) shared++;
  }
  return shared;
}

function keywordFallback(task, skillNames, k) {
  const taskTokens = tokenize(task);
  const scored = skillNames.map((name, i) => ({ name, i, score: overlapScore(taskTokens, name) }));
  scored.sort((a, b) => (b.score - a.score) || (a.i - b.i));
  return scored.slice(0, k).map(x => x.name);
}

// Main export

/**
 * Returns the K skill names most relevant to the task.
 * Uses embedding cosine similarity; falls back to keyword overlap on error.
 */
async function retrieveRelevantSkills(task, skillNames = [], k = TOPK) {
  if (!Array.isArray(skillNames) || skillNames.length <= k) {
    return skillNames || [];
  }

  try {
    return await retrieveByEmbedding(task, skillNames, k, embedQuery, embedDocument);
  } catch (err) {
    logger.warn("Retrieval", `Embedding retrieval failed, using keyword fallback: ${err.message}`);
    return keywordFallback(task, skillNames, k);
  }
}

module.exports = { retrieveRelevantSkills };
