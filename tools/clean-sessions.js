/**
 * Supprime les sessions "ininteressantes" (moins de 5 items distincts).
 * Sans danger par defaut : dry-run (n'efface rien) tant qu'on ne passe pas --delete.
 * Voir `node tools/clean-sessions.js --help`.
 */

const fs   = require("fs");
const path = require("path");

const SESSIONS_DIR = path.resolve(__dirname, "..", "sessions");

// ---- CLI args ---------------------------------------------------------------

const argv = process.argv.slice(2);

function flag(name) {
  return argv.includes(`--${name}`);
}
function value(name, def) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1 || i + 1 >= argv.length) return def;
  const n = Number(argv[i + 1]);
  return Number.isNaN(n) ? def : n;
}

if (flag("help") || flag("h")) {
  console.log(`clean-sessions — delete sessions with fewer than N distinct items

  --delete           actually delete (default: dry-run, deletes nothing)
  --min-items <n>    keep a session only if it saw >= n distinct items (default 5)
  --grace <min>      never touch files modified within n minutes       (default 2)
  --help             show this help`);
  process.exit(0);
}

const DELETE     = flag("delete") || flag("d");
const MIN_ITEMS  = value("min-items", 5);
const GRACE_MIN  = value("grace", 2);   // minutes

// ---- Helpers ----------------------------------------------------------------

/** Taille lisible (octets). */
function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Complete a droite. */
function pad(s, w) {
  s = String(s);
  return s.length >= w ? s : s + " ".repeat(w - s.length);
}
/** Complete a gauche (nombres). */
function padL(s, w) {
  s = String(s);
  return s.length >= w ? s : " ".repeat(w - s.length) + s;
}

/** Lit une session : nombre d'items distincts (+ flag corrompu). */
function analyze(file) {
  const full = path.join(SESSIONS_DIR, file);
  const stat = fs.statSync(full);

  let items = 0;
  let corrupt = false;
  try {
    const data = JSON.parse(fs.readFileSync(full, "utf8"));
    items = Array.isArray(data.seenItems) ? data.seenItems.length : 0;
  } catch {
    corrupt = true; // JSON illisible -> 0 item
  }

  const ageMin = (Date.now() - stat.mtimeMs) / 60000;
  return { file, size: stat.size, items, corrupt, recentlyActive: ageMin < GRACE_MIN };
}

// ---- Main -------------------------------------------------------------------

if (!fs.existsSync(SESSIONS_DIR)) {
  console.log(`No sessions directory at ${SESSIONS_DIR}. Nothing to do.`);
  process.exit(0);
}

const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith(".json")).sort();
if (files.length === 0) {
  console.log("No session files found.");
  process.exit(0);
}

const rows = files.map(analyze);

console.log(`Sessions dir: ${SESSIONS_DIR}`);
console.log(`Rule: delete sessions with fewer than ${MIN_ITEMS} distinct items.`);
console.log(`Mode: ${DELETE ? "DELETE" : "dry-run (no files removed)"}\n`);

console.log(`${pad("FILE", 28)} ${padL("ITEMS", 5)} ${padL("SIZE", 9)}  VERDICT`);
console.log("-".repeat(60));

const toDelete = [];
let freed = 0;

for (const r of rows) {
  let verdict;
  if (r.recentlyActive) {
    verdict = "skip (active)";
  } else if (r.corrupt) {
    verdict = "DELETE (corrupt)";
  } else if (r.items < MIN_ITEMS) {
    verdict = `DELETE (${r.items} item${r.items === 1 ? "" : "s"})`;
  } else {
    verdict = "keep";
  }

  if (verdict.startsWith("DELETE")) {
    toDelete.push(r);
    freed += r.size;
  }

  console.log(`${pad(r.file, 28)} ${padL(r.corrupt ? "--" : r.items, 5)} ${padL(humanSize(r.size), 9)}  ${verdict}`);
}

console.log("-".repeat(60));
console.log(`${rows.length} session(s): ${rows.length - toDelete.length} kept, ${toDelete.length} to delete (~${humanSize(freed)}).`);

if (toDelete.length === 0) {
  console.log("Nothing to remove.");
  process.exit(0);
}

if (!DELETE) {
  console.log("\nDry-run only. Re-run with --delete to remove the candidates above.");
  process.exit(0);
}

for (const r of toDelete) {
  try {
    fs.unlinkSync(path.join(SESSIONS_DIR, r.file));
    console.log(`Deleted ${r.file}`);
  } catch (err) {
    console.log(`Failed to delete ${r.file}: ${err.message}`);
  }
}
console.log(`\nDone. Removed ${toDelete.length} session(s), freed ~${humanSize(freed)}.`);
