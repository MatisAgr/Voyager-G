/**
 * Identite du run : username "<base>_<iteration>" (ex. "Voyager-G_3").
 * Chaque iteration = un joueur Minecraft neuf, donc l'etat est porte par le serveur.
 * --clear incremente l'iteration ; un redemarrage normal reprend la derniere.
 */

const fs = require("fs");
const path = require("path");
const logger = require("../utils/logger");

const STATE_DIR = path.resolve(process.env.STATE_DIR || "state");
const BASE_NAME = process.env.MC_USERNAME || "Voyager-G";

/** Cree le dossier d'etat si besoin. */
function ensureDir() {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    logger.info("Run", `Created state directory at ${STATE_DIR}`);
  }
}

/** Fichier compteur d'iteration pour ce nom de base. */
function counterFile() {
  const safe = BASE_NAME.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(STATE_DIR, `${safe}.iteration.json`);
}

/** Lit la derniere iteration (0 si aucune). */
function readIteration() {
  try {
    const data = JSON.parse(fs.readFileSync(counterFile(), "utf-8"));
    return Number.isInteger(data.iteration) ? data.iteration : 0;
  } catch {
    return 0;
  }
}

/** Sauvegarde l'iteration courante. */
function writeIteration(iteration) {
  ensureDir();
  const payload = { baseName: BASE_NAME, iteration, updatedAt: new Date().toISOString() };
  try {
    fs.writeFileSync(counterFile(), JSON.stringify(payload, null, 2), "utf-8");
  } catch (err) {
    logger.warn("Run", `Failed to persist iteration counter: ${err.message}`);
  }
}

/** Calcule l'identite du run (iteration + username). A appeler une fois au demarrage. */
function resolveRun({ fresh = false } = {}) {
  ensureDir();

  const override = parseInt(process.env.RUN_ITERATION, 10);
  let iteration;

  if (!Number.isNaN(override)) {
    iteration = override;
  } else {
    const last = readIteration();
    iteration = fresh ? last + 1 : (last || 1);
  }

  writeIteration(iteration);

  const username = `${BASE_NAME}_${iteration}`;
  return { iteration, username, baseName: BASE_NAME };
}

module.exports = { resolveRun };
