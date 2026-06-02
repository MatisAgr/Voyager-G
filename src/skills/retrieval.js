/**
 * Selection des skills pertinents : au lieu d'envoyer tous les noms au prompt,
 * on garde les top-K par proximite avec la tache (sans appel API, donc gratuit).
 */

const TOPK = parseInt(process.env.SKILL_RETRIEVAL_TOPK, 10) || 12;

/** Decoupe une chaine en mots (minuscules, alphanumeriques). */
function tokenize(s) {
  return new Set(
    String(s)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
  );
}

/** Compte les mots du nom du skill presents dans la tache. */
function overlapScore(taskTokens, name) {
  let shared = 0;
  for (const t of tokenize(name)) {
    if (taskTokens.has(t)) shared++;
  }
  return shared;
}

/** Renvoie les K skills les plus pertinents (tous si moins de K). */
function retrieveRelevantSkills(task, skillNames = [], k = TOPK) {
  if (!Array.isArray(skillNames) || skillNames.length <= k) {
    return skillNames || [];
  }

  const taskTokens = tokenize(task);

  // Tri par score decroissant, ordre d'origine en cas d'egalite.
  const scored = skillNames.map((name, i) => ({ name, i, score: overlapScore(taskTokens, name) }));
  scored.sort((a, b) => (b.score - a.score) || (a.i - b.i));

  return scored.slice(0, k).map((x) => x.name);
}

module.exports = { retrieveRelevantSkills };
