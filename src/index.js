/**
 * Main entry point.
 * Starts the bot in autonomous mode, player mode, test mode, or freeze mode.
*/

const path = require("path");
process.chdir(path.resolve(__dirname, ".."));
require("dotenv").config();

const fs            = require("fs");
const minecraftData = require("minecraft-data");
const { Movements } = require("mineflayer-pathfinder");
const { createBot } = require("./bot/createBot");
const { registerEvents } = require("./bot/events");
const { ensureOp, startRconMaintenance } = require("./bot/rcon");
const { observe } = require("./observer");
const { inventoryCounts } = require("./observer/inventory");
const { executeTask } = require("./brain/actionAgent");
const { getUsedLearnedTaskCount } = require("./brain/actionAgent");
const { verifyCritic } = require("./brain/criticAgent");
const { proposeNextTask } = require("./curriculum/curriculum");
const { startPlayerMode } = require("./brain/playerMode");
const { startTestMode } = require("./brain/testMode");
const { startFreezeMode } = require("./brain/freezeMode");
const { saveSkill, listSkills } = require("./skills/library");
const { resolveRun } = require("./state/run");
const { startDashboard, emitDataPoint, addSkill, addPosition } = require("./dashboard/server");
const inventoryViewer = require("mineflayer-web-inventory");
const logger = require("./utils/logger");
const { sleep } = require("./utils/helpers");
const { getAgentPromptCount, getCurriculumPromptCount, getCodeGenPromptCount } = require("./brain/gemini");

// Keep process alive on unhandled async/runtime errors.
process.on("unhandledRejection", (reason) => {
  logger.error("Main", `Unhandled promise rejection (caught at process level): ${reason?.message || reason}`);
});
process.on("uncaughtException", (err) => {
  logger.error("Main", `Uncaught exception (caught at process level): ${err.message}`);
});

const CLEAR_MODE  = process.argv.includes("--clear");
const LIBRARY_DIR = path.resolve(process.env.SKILLS_LIBRARY_DIR || "src/skills/learned");

// --clear: wipe the skill library so the agent starts with no prior knowledge.
if (CLEAR_MODE) {
  if (fs.existsSync(LIBRARY_DIR)) {
    const files = fs.readdirSync(LIBRARY_DIR).filter(f => f.endsWith(".js"));
    for (const f of files) fs.unlinkSync(path.join(LIBRARY_DIR, f));
    logger.info("Main", `--clear: removed ${files.length} skill(s) from ${LIBRARY_DIR}`);
  } else {
    logger.info("Main", "--clear: learned/ directory is already empty or does not exist.");
  }
}

const RUN = resolveRun({ fresh: CLEAR_MODE });
logger.info("Main", `Run iteration ${RUN.iteration} -> Minecraft username "${RUN.username}".`);
logger.info("Main", `Reminder: grant OP to this username on the server (/op ${RUN.username}) for scoreboard commands.`);

// Taches a ne pas reproposer (en memoire, par run). La progression vient de l'etat du jeu.
const failedTasks = [];

// Force exploration after too many failures.
let consecutiveFailures = 0;
const MAX_CONSECUTIVE_FAILURES = parseInt(process.env.MAX_CONSECUTIVE_FAILURES, 10) || 5;
// Delai avant le jugement du critic, pour laisser ramasser les objets tombes.
const CRITIC_SETTLE_MS = parseInt(process.env.CRITIC_SETTLE_MS, 10) || 1000;

// Feedback from critic after a failed task.
let lastCritique = "";
// Used to stop old loops after reconnect.
let currentGeneration = 0;

/**
 * Main autonomous loop.
 * `generation` links this loop to one bot instance.
 */
async function mainLoop(bot, mcData, generation) {
  logger.info("Main", "Starting the autonomous agent loop...");

  // observe -> plan -> act -> verify -> learn -> repeat
  while (generation === currentGeneration) {
    try {
      // Step 1: Observe the game state
      const gameState = observe(bot);
      logger.debug("Main", `Observation:\n${gameState}`);

      // Emergency override if starving and low health.
      let task;
      if (bot.food <= 2 && bot.health < 10) {
        task = "Kill the nearest animal (cow, pig, chicken, or sheep) to get food and eat it.";
        logger.warn("Main", `Health emergency (HP=${bot.health}, Food=${bot.food}) - overriding curriculum with survival task.`);
      } else if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        // Stuck guard.
        task = "Explore: walk in a random direction for 200 blocks to find new resources and biomes.";
        logger.warn("Main", `Stuck detected (${consecutiveFailures} consecutive failures) - forcing exploration.`);
        consecutiveFailures = 0;  // Reset after forced exploration
      } else {
        // Step 2 : demander la prochaine tache. Les skills appris + l'inventaire
        // servent de signal de progression (plus de completedTasks[]).
        const learnedSkills = listSkills();
        task = await proposeNextTask(gameState, learnedSkills, failedTasks, lastCritique);
        lastCritique = "";  // Clear after consumption
      }

      // Bail if a reconnect happened while we were waiting for the LLM
      if (generation !== currentGeneration) break;

      // Step 3: Capture state BEFORE execution (for critic comparison)
      const stateBefore = gameState;
      const invBefore = inventoryCounts(bot);

      // Step 4: Execute the task via the action agent
      const availableSkills = listSkills();
      const result = await executeTask(bot, mcData, stateBefore, task, availableSkills);

      // Bail if a reconnect happened during execution
      if (generation !== currentGeneration) break;

      // Laisser le temps aux objets tombes d'etre ramasses avant de juger.
      await sleep(CRITIC_SETTLE_MS);
      if (generation !== currentGeneration) break;

      // Verify success from before/after state.
      const stateAfter = observe(bot);
      const invAfter = inventoryCounts(bot);
      let verified = result.success;

      if (result.success) {
        const verdict = await verifyCritic(task, stateBefore, stateAfter, result.result, invBefore, invAfter);
        verified = verdict.success;

        if (!verified) {
          logger.warn("Main", `Critic REJECTED task "${task}": ${verdict.reasoning}`);
          lastCritique = verdict.critique;
        }
      }

      // Update history.
      // Le skill est deja sauvegarde sur disque des que le code reussit :
      // on l'affiche dans le dashboard (dashboard = disque), que le critic valide ou non.
      if (result.saved) {
        logger.info("Main", `New skill learned: "${result.taskName}"`);
        addSkill(result.taskName);
      }

      // Le critic ne pilote que le curriculum (streak de succes + taches a eviter).
      if (verified) {
        consecutiveFailures = 0;  // Reset on success
        if (!result.saved) {
          logger.info("Main", `Task completed (used existing skill): "${task}"`);
        }
      } else {
        consecutiveFailures++;
        const reason = result.success ? "Critic rejected" : result.result;
        logger.warn("Main", `Task failed: "${task}" - ${reason} (streak: ${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES})`);
        // Track failed tasks so the curriculum avoids reproposing them
        if (!failedTasks.includes(task)) failedTasks.push(task);
      }

      // Emit dashboard metrics.
      emitDataPoint({
        codeGen:    getCodeGenPromptCount(),
        agent:      getAgentPromptCount(),
        curriculum: getCurriculumPromptCount(),
        usedLearned: getUsedLearnedTaskCount(),
      }, bot);

      // Small breathing room between cycles
      await sleep(3000);
    } catch (err) {
      // If the bot disconnected, exit cleanly
      if (generation !== currentGeneration) break;
      logger.error("Main", `Unexpected error in main loop: ${err.message}`);
      // Wait before retrying to avoid a tight error loop
      await sleep(5000);
    }
  }

  logger.info("Main", `Loop generation ${generation} ended (current: ${currentGeneration}).`);
}

// Bootstrap.

/** Creates the bot and wires startup logic. */
function startAgent() {
  // Stop old loop generation.
  const generation = ++currentGeneration;

  // Start dashboard once.
  if (generation === 1) {
    startDashboard();
  }

  const bot = createBot(RUN.username);
  registerEvents(bot);

  // Local inventory viewer.
  const inventoryViewerPort = parseInt(process.env.INVENTORY_VIEWER_PORT, 10) || 3000;
  inventoryViewer(bot, { port: inventoryViewerPort });

  // Auto reconnect after disconnect.
  bot.on("end", () => {
    logger.warn("Main", "Bot disconnected - reconnecting in 10 s...");
    setTimeout(startAgent, 10000);
  });

  bot.once("spawn", async () => {
  logger.info("Main", "Bot spawned - waiting for chunks to load...");

  await bot.waitForChunksToLoad();
  logger.info("Main", "Chunks loaded - initialising agent...");

  // Op le bot via RCON (avant --clear qui en a besoin). Sans effet si RCON desactive.
  await ensureOp(RUN.username);

  // --clear: teleport to a random location before starting training.
  if (CLEAR_MODE && generation === 1) {
    const MAX_COORD = 10000;
    const rx = Math.floor(Math.random() * MAX_COORD * 2) - MAX_COORD;
    const rz = Math.floor(Math.random() * MAX_COORD * 2) - MAX_COORD;
    logger.info("Main", `--clear: teleporting to (${rx}, ~, ${rz})...`);
    try {
      // Creative mode prevents fall damage during the landing sequence.
      await bot.chat(`/gamemode creative`);
      await sleep(500);

      // Clear inventory, restore health and hunger to a clean starting state.
      await bot.chat(`/clear @s`);
      await bot.chat(`/effect give @s minecraft:instant_health 1 4`);
      await bot.chat(`/effect give @s minecraft:saturation 5 20`);
      await sleep(500);
      logger.info("Main", "--clear: inventory cleared, health and hunger restored.");

      // Step 1: teleport high (Y=300) — always above any terrain.
      await bot.chat(`/tp ${rx} 300 ${rz}`);
      await sleep(3000);
      await bot.waitForChunksToLoad();

      // Step 2: scan downward to find the first solid surface block.
      // bot.blockAt() requires a Vec3 instance, not a plain object.
      const { Vec3 } = require("vec3");
      const groundY = await (async () => {
        for (let y = 255; y >= 63; y--) {
          const block = bot.blockAt(new Vec3(rx, y, rz));
          if (block && block.name !== "air" && block.name !== "cave_air" &&
              block.name !== "void_air" && block.name !== "water" &&
              block.name !== "lava") {
            return y + 1;
          }
        }
        return 64;
      })();

      // Step 3: land on the surface, then restore survival mode.
      logger.info("Main", `--clear: landing at (${rx}, ${groundY}, ${rz})`);
      await bot.chat(`/tp ${rx} ${groundY} ${rz}`);
      await sleep(2000);
      await bot.waitForChunksToLoad();
      // Set the world spawn at this location so the bot respawns here if it dies.
      await bot.chat(`/setworldspawn ${rx} ${groundY} ${rz}`);
      await sleep(500);
      await bot.chat(`/gamemode survival`);
      await sleep(500);
    } catch (tpErr) {
      logger.warn("Main", `--clear: setup failed - ${tpErr.message}`);
      // Ensure survival mode even if something went wrong mid-sequence.
      // bot.chat() may return undefined — use try/catch instead of .catch().
      try { await bot.chat(`/gamemode survival`); } catch (_) {}
    }
  }

  // Extra startup delay to avoid early movement kicks.
  await sleep(8000);

  // Bail if a reconnect already happened during the wait
  if (generation !== currentGeneration) return;

  // Load minecraft-data for item/block look-ups
  const mcData = minecraftData(bot.version);

  // Configure pathfinder.
  const defaultMove = new Movements(bot);
  defaultMove.canDig = true;
  defaultMove.allowParkour = true;
  defaultMove.allowSprinting = true;
  bot.pathfinder.setMovements(defaultMove);
  bot.pathfinder.thinkingTimeout = 10000;

  // Emit initial dashboard point.
  emitDataPoint({
    codeGen:    getCodeGenPromptCount(),
    agent:      getAgentPromptCount(),
    curriculum: getCurriculumPromptCount(),
    usedLearned: getUsedLearnedTaskCount(),
  }, bot);

  // Track position for the dashboard map.
  const posInterval = setInterval(() => {
    if (generation !== currentGeneration) { clearInterval(posInterval); return; }
    const pos = bot.entity?.position;
    if (pos) addPosition(pos.x, pos.y, pos.z, bot);
  }, 5000);
  bot.on("end", () => clearInterval(posInterval));

  // Maintenance RCON : scoreboard sante/faim + effets permanents (a la place du bot).
  const rconMaint = startRconMaintenance(bot);
  if (rconMaint) bot.on("end", () => clearInterval(rconMaint));

  // Select run mode.
const mode = process.argv.includes("--freeze") ? "freeze"
  : process.argv.includes("--test") ? "test"
  : process.argv.includes("--player") ? "player"
  : "autonomous";

  if (mode === "freeze") {
    logger.info("Main", "Starting in FREEZE mode (--freeze)");
    startFreezeMode(bot, () => mainLoop(bot, mcData, generation));
  } else if (mode === "test") {
    logger.info("Main", "Starting in TEST mode (--test)");
    startTestMode(bot, mcData);
  } else if (mode === "player") {
    logger.info("Main", "Starting in PLAYER mode (--player)");
    startPlayerMode(bot, mcData);
  } else {
    logger.info("Main", "Starting in AUTONOMOUS mode");
    mainLoop(bot, mcData, generation);
  }
  });
}

startAgent();
