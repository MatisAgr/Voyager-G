/**
 * Skill library manager.
 * Saves, lists, and loads learned skills from disk.
 */

const fs = require("fs");
const path = require("path");
const logger = require("../utils/logger");

// Learned skills folder.
const LIBRARY_DIR = path.resolve(process.env.SKILLS_LIBRARY_DIR || "src/skills/learned");

/** Ensures the library folder exists. */
function ensureLibraryDir() {
  if (!fs.existsSync(LIBRARY_DIR)) {
    fs.mkdirSync(LIBRARY_DIR, { recursive: true });
    logger.info("SkillLib", `Created skill library at ${LIBRARY_DIR}`);
  }
}

/**
 * Saves a new skill (JavaScript code) to the library.
 *
 */
function saveSkill(name, code, description = "") {
  ensureLibraryDir();

  // Build a safe file name.
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
  const filePath = path.join(LIBRARY_DIR, `${safeName}.js`);

  const header = `/**\n * Skill: ${name}\n * ${description}\n * Saved: ${new Date().toISOString()}\n */\n\n`;
  fs.writeFileSync(filePath, header + code, "utf-8");

  logger.info("SkillLib", `Saved skill "${safeName}" to library`);
}

/** Returns all skill names. */
function listSkills() {
  ensureLibraryDir();

  return fs
    .readdirSync(LIBRARY_DIR)
    .filter((f) => f.endsWith(".js"))
    .map((f) => f.replace(".js", ""));
}

/** Loads one skill source code by name. */
function loadSkill(name) {
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
  const filePath = path.join(LIBRARY_DIR, `${safeName}.js`);

  if (!fs.existsSync(filePath)) {
    logger.warn("SkillLib", `Skill "${safeName}" not found in library`);
    return null;
  }

  return fs.readFileSync(filePath, "utf-8");
}

module.exports = { saveSkill, listSkills, loadSkill, ensureLibraryDir };
