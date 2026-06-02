/**
 * Bot event handlers.
 * Registers connection and in-game events.
 */

const logger = require("../utils/logger");

/** Registers core event handlers. */
function registerEvents(bot) {
  // Connection lifecycle.

  bot.once("spawn", () => {
    logger.info("Bot", "Bot has spawned in the world.");
  });

  bot.on("login", () => {
    logger.info("Bot", "Bot successfully logged into the server.");
  });

  bot.on("end", (reason) => {
    logger.warn("Bot", `Bot disconnected: ${reason}`);
  });

  bot.on("kicked", (reason) => {
    logger.error("Bot", `Bot was kicked: ${reason}`);
  });

  bot.on("error", (err) => {
    logger.error("Bot", `Connection error: ${err.message}`);
  });

  // In-game events.

  bot.on("death", () => {
    logger.warn("Bot", "Bot died! Respawning...");
  });

  bot.on("health", () => {
    logger.debug("Bot", `Health: ${bot.health} | Food: ${bot.food}`);
    // Le bot est auto-ope via RCON au spawn
    const health = Math.round(bot.health);
    const food   = Math.round(bot.food);
    bot.chat(`/scoreboard players set Health Stats ${health}`);
    bot.chat(`/scoreboard players set Food Stats ${food}`);
  });

  // Stop pathfinder completely when the bot takes damage.
  // Knockback from mobs moves the bot's real position while pathfinder
  // keeps sending its own movement packets. The vanilla server sees the
  // mismatch and kicks for "Invalid move player packet".
  // We must:
  //   1. Cancel the active pathfinder goal (setGoal(null)).
  //   2. Release all virtual keys (clearControlStates) so the bot
  //      stops sending walk/sprint/jump packets during the knockback.
  bot.on("entityHurt", (entity) => {
    if (entity === bot.entity) {
      logger.debug("Bot", "Took damage - suspending pathfinder to absorb knockback.");
      try {
        bot.pathfinder.setGoal(null);
        bot.clearControlStates();
      } catch (_) {
        // pathfinder may not be loaded yet during early spawn
      }
    }
  });

  bot.on("chat", (username, message) => {
    // Ignore the bot's own messages
    if (username === bot.username) return;
    logger.info("Chat", `<${username}> ${message}`);
  });
}

module.exports = { registerEvents };
