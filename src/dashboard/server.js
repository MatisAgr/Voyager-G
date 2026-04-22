/**
 * Dashboard backend.
 * Serves the UI and streams runtime metrics through Socket.IO.
 */

const express    = require("express");
const http       = require("http");
const https      = require("https");
const fs         = require("fs");
const { Server } = require("socket.io");
const path       = require("path");
const logger     = require("../utils/logger");

const DASHBOARD_PORT = parseInt(process.env.DASHBOARD_PORT, 10) || 3001;

// Base URL for Minecraft 1.20.1 item/block renders (nerothe.com)
const ICON_BASE = "https://mc.nerothe.com/img/1.20.1/";

// In-memory PNG cache so each icon is fetched only once per session
const iconCache = new Map();

// Socket.IO server instance (set when startDashboard is called)
let io = null;

// Timestamp when the current agent session started
const sessionStartTime = Date.now();

// Path to the skill library on disk — mirrors the constant in library.js
const SKILLS_LIBRARY_DIR = path.resolve(
  process.env.SKILLS_LIBRARY_DIR || "src/skills/learned"
);

// Directory where session JSON files are stored
const SESSIONS_DIR = path.join(__dirname, "..", "..", "sessions");
if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });

// Generate a human-readable session filename: YYYY-MM-DD_HH-MM-SS.json
const sessionFileName = new Date().toISOString()
  .replace(/T/, "_").replace(/:/g, "-").replace(/\.\d+Z$/, "") + ".json";
const sessionFilePath = path.join(SESSIONS_DIR, sessionFileName);

// Autosave interval (every 30 s)
const AUTOSAVE_INTERVAL = 30000;
// Persistent map block data: { "x,z": colorHex }
// Shared with clients on connect and updated incrementally.
const mapBlocks = {};

// Minecraft block -> map color mapping (top-down view, like vanilla map colors)
const BLOCK_COLORS = {
  // Grass / vegetation
  grass_block: "#6d9930", short_grass: "#6d9930", tall_grass: "#6d9930",
  fern: "#5b8c29", large_fern: "#5b8c29",
  // Dirt variants
  dirt: "#8b6b47", coarse_dirt: "#7a5c3a", farmland: "#6b4f33",
  podzol: "#5b4326", mycelium: "#6b5d6b", rooted_dirt: "#7a6045",
  mud: "#3b3328", muddy_mangrove_roots: "#44392e",
  // Stone / ores
  stone: "#7f7f7f", cobblestone: "#7a7a7a", mossy_cobblestone: "#6a7a5a",
  granite: "#9a6c50", diorite: "#bcbcbc", andesite: "#888888",
  deepslate: "#505050", tuff: "#6a6a5f",
  coal_ore: "#636363", iron_ore: "#8a7e6e", copper_ore: "#7a6b5a",
  gold_ore: "#8a8050", diamond_ore: "#5abcbc", lapis_ore: "#344f8a",
  redstone_ore: "#8a3030", emerald_ore: "#3a8a3a",
  // Sand / gravel
  sand: "#dbd3a0", red_sand: "#a05020", gravel: "#857d76",
  sandstone: "#d4c484", red_sandstone: "#a04020",
  clay: "#9a9aaa",
  // Water / ice
  water: "#3f76e4", ice: "#7dadff", blue_ice: "#74b4ff",
  // Lava
  lava: "#d44a00",
  // Snow
  snow: "#fafafa", snow_block: "#fafafa", powder_snow: "#f0f0f0",
  // Wood / trees
  oak_log: "#6b5230", oak_leaves: "#4a7a2a", oak_planks: "#b8945f",
  birch_log: "#d5caa0", birch_leaves: "#6b993a",
  spruce_log: "#3b2810", spruce_leaves: "#3a5a20",
  dark_oak_log: "#3a2a10", dark_oak_leaves: "#2a5a10",
  jungle_log: "#5a4a20", jungle_leaves: "#3a8a30",
  acacia_log: "#5a4a3a", acacia_leaves: "#6a9a30",
  mangrove_log: "#5a3028", mangrove_leaves: "#4a7a2a",
  cherry_log: "#3a2028", cherry_leaves: "#e8a0b0",
  // Flowers / crops
  dandelion: "#d4d420", poppy: "#e03030",
  wheat: "#c4a030", carrots: "#e08020", potatoes: "#c4a040",
  // Nether
  netherrack: "#6a2020", soul_sand: "#4a3a28", soul_soil: "#3a2e1e",
  basalt: "#484848", blackstone: "#2a2028",
  nether_bricks: "#2c1014", crimson_nylium: "#7a1020",
  warped_nylium: "#1a6a5a",
  // End
  end_stone: "#d4d4a0", purpur_block: "#a47aa4",
  // Misc
  bedrock: "#3a3a3a", obsidian: "#0d0a14",
};

// Tracks which columns have already been scanned so we skip them on repeat visits.
const scannedColumns = new Set();

/**
 * Scans a radius around the bot, reading the top non-air block at each column.
 * Only new columns are scanned (deduplicated via scannedColumns).
 * Returns an array of { x, z, color } entries for the dashboard.
 */
function scanNearbyTerrain(bot, botX, botZ) {
  const SCAN_RADIUS = 8;  // blocks around bot in each direction (17x17 square)
  const results = [];

  for (let dx = -SCAN_RADIUS; dx <= SCAN_RADIUS; dx++) {
    for (let dz = -SCAN_RADIUS; dz <= SCAN_RADIUS; dz++) {
      const x = botX + dx;
      const z = botZ + dz;
      const key = `${x},${z}`;
      if (scannedColumns.has(key)) continue;
      scannedColumns.add(key);

      // Find top non-air block by scanning downward from bot Y + 20
      const startY = Math.min((bot.entity?.position?.y || 64) + 20, 319);
      let color = null;

      for (let y = startY; y >= -64; y--) {
        try {
          const block = bot.blockAt({ x, y, z });
          if (!block || block.name === "air" || block.name === "cave_air" || block.name === "void_air") continue;
          color = BLOCK_COLORS[block.name] || "#7f7f7f";  // default grey for unknown
          break;
        } catch (_) {
          break;  // chunk not loaded
        }
      }

      if (color) {
        mapBlocks[key] = color;
        results.push({ x, z, color });
      }
    }
  }
  return results;
}
//  Persistent session state 
const dataPoints = [];   // { promptCount, distinctItems, newItems, timestamp }
const seenItems  = new Set();
const skills     = [];   // { name, savedAt }
const positions  = [];   // { x, z }

/**
 * Reads every .js file in the skill library folder and populates the skills
 * array with the real filesystem mtime so the dashboard always reflects the
 * learned/ directory — even after a restart.
 */
function syncSkillsFromDisk() {
  if (!fs.existsSync(SKILLS_LIBRARY_DIR)) return;
  skills.length = 0;
  const entries = fs.readdirSync(SKILLS_LIBRARY_DIR)
    .filter(f => f.endsWith(".js"))
    .map(f => ({
      name:    f.replace(".js", ""),
      savedAt: fs.statSync(path.join(SKILLS_LIBRARY_DIR, f)).mtimeMs,
    }))
    .sort((a, b) => a.savedAt - b.savedAt);
  skills.push(...entries);
  logger.info("Dashboard", `Loaded ${skills.length} skill(s) from disk`);
}


//  Icon proxy 
/**
 * Fetches an HTTPS URL and returns its body as a Buffer.
 * Follows up to 3 redirects, times out after 5 s.
 */
function fetchBuffer(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 3) return reject(new Error("Too many redirects"));
    const req = https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        res.resume();
        return fetchBuffer(res.headers.location, redirects + 1)
          .then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on("data",  (c) => chunks.push(c));
      res.on("end",   () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error("Timeout")); });
  });
}

//  Server bootstrap 
/**
 * Starts the Express + Socket.IO dashboard server.
 * Call once at agent startup.
 */
function startDashboard() {
  // Sync skill list now — after any --clear deletion has already happened.
  syncSkillsFromDisk();

  const app    = express();
  const server = http.createServer(app);
  io = new Server(server);

  // Serve static files from public/ (index.html, style.css, dashboard.js)
  app.use(express.static(path.join(__dirname, "public")));

  // Proxy route: /api/icon/<itemName> -> nerothe.com PNG
  // Results are cached in memory to avoid repeated outbound requests.
  app.get("/api/icon/:name", async (req, res) => {
    const name = req.params.name.replace(/[^a-z0-9_]/g, "");
    if (!name) return res.status(400).end();

    if (iconCache.has(name)) {
      const cached = iconCache.get(name);
      if (cached === "404") return res.status(404).end();
      return res.type("image/png").send(cached);
    }

    try {
      const buf = await fetchBuffer(`${ICON_BASE}${name}.png`);
      iconCache.set(name, buf);
      res.type("image/png").send(buf);
    } catch (_) {
      iconCache.set(name, "404");
      res.status(404).end();
    }
  });

  // List all saved session files (name only, sorted newest first)
  app.get("/api/sessions", (_req, res) => {
    try {
      const files = fs.readdirSync(SESSIONS_DIR)
        .filter(f => f.endsWith(".json"))
        .sort()
        .reverse();
      res.json(files);
    } catch (_) {
      res.json([]);
    }
  });

  // Load a specific session's data by filename
  app.get("/api/sessions/:name", (req, res) => {
    const name = req.params.name.replace(/[^a-z0-9A-Z_.\-]/g, "");
    if (!name.endsWith(".json")) return res.status(400).end();
    const filePath = path.join(SESSIONS_DIR, name);
    if (!fs.existsSync(filePath)) return res.status(404).end();
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      res.type("application/json").send(raw);
    } catch (_) {
      res.status(500).end();
    }
  });

  // On (re)connect send full history so the browser rebuilds from scratch
  io.on("connection", (socket) => {
    logger.info("Dashboard", `Client connected (${socket.id})`);
    socket.emit("history", {
      dataPoints,
      seenItems:        Array.from(seenItems),
      skills,
      positions,
      mapBlocks,
      sessionStartTime,
    });
  });

  server.listen(DASHBOARD_PORT, () => {
    logger.info("Dashboard", `Dashboard running at http://localhost:${DASHBOARD_PORT}`);
  });
}

//  Data helpers (called from index.js main loop) 
/**
 * Scans the bot inventory, records new items, pushes a data point.
 */
function emitDataPoint(stats, bot) {
  const newItems = [];
  for (const item of bot.inventory.items()) {
    if (!seenItems.has(item.name)) {
      seenItems.add(item.name);
      newItems.push(item.name);
    }
  }

  const point = {
    // promptCount = code-gen iterations only (X-axis of the Voyager graph)
    promptCount:      stats.codeGen,
    agentCount:       stats.agent,
    curriculumCount:  stats.curriculum,
    usedLearnedCount: stats.usedLearned,
    distinctItems:    seenItems.size,
    newItems,
    timestamp:        Date.now(),
  };
  dataPoints.push(point);
  if (io) io.emit("datapoint", point);

  if (newItems.length > 0) {
    logger.info(
      "Dashboard",
      `New items: [${newItems.join(", ")}] | distinct: ${seenItems.size} | agent prompts: ${stats.agent} | codegen: ${stats.codeGen}`
    );
  }
}

/**
 * Records a newly saved skill and broadcasts it to the dashboard.
 * Uses the actual file mtime so the timestamp matches the filesystem.
 */
function addSkill(name) {
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
  const filePath = path.join(SKILLS_LIBRARY_DIR, `${safeName}.js`);
  const savedAt  = fs.existsSync(filePath)
    ? fs.statSync(filePath).mtimeMs
    : Date.now();

  // Avoid duplicates: replace if already loaded from disk.
  const idx = skills.findIndex(s => s.name === safeName);
  const entry = { name: safeName, savedAt };
  if (idx !== -1) skills[idx] = entry;
  else skills.push(entry);

  if (io) io.emit("skill_added", entry);
}

/**
 * Records the bot's world position (call every ~5 s for the map view).
 * Also scans a small area around the bot for the top block color at each column.
 */
function addPosition(x, y, z, bot) {
  const entry = { x: Math.round(x), z: Math.round(z) };
  positions.push(entry);
  if (io) io.emit("position", entry);

  // Scan blocks around the bot for the real terrain map
  if (bot) {
    const chunks = scanNearbyTerrain(bot, Math.round(x), Math.round(z));
    if (chunks.length > 0 && io) io.emit("map_blocks", chunks);
  }
}

/** Returns the number of distinct item types observed so far. */
function getDistinctItemCount() { return seenItems.size; }

/**
 * Saves the current session state to a JSON file on disk.
 * Called periodically and on process exit.
 */
function saveSession() {
  const data = {
    sessionStartTime,
    savedAt: Date.now(),
    dataPoints,
    seenItems:  Array.from(seenItems),
    skills,
    positions,
    mapBlocks,
  };
  try {
    fs.writeFileSync(sessionFilePath, JSON.stringify(data), "utf8");
    logger.debug("Dashboard", `Session saved to ${sessionFileName}`);
  } catch (err) {
    logger.error("Dashboard", `Failed to save session: ${err.message}`);
  }
}

// Autosave every 30 s
setInterval(saveSession, AUTOSAVE_INTERVAL);
// Save on clean shutdown
process.on("exit", saveSession);
process.on("SIGINT", () => { saveSession(); process.exit(0); });
process.on("SIGTERM", () => { saveSession(); process.exit(0); });

module.exports = {
  startDashboard,
  emitDataPoint,
  addSkill,
  addPosition,
  getDistinctItemCount,
};
