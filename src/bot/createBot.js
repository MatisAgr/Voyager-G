/**
 * Mineflayer bot factory.
 * Creates the bot and loads required plugins.
 */

const mineflayer = require("mineflayer");
const { pathfinder } = require("mineflayer-pathfinder");
const logger = require("../utils/logger");

const MC_HOST     = process.env.MC_HOST     || "localhost";
const MC_PORT     = parseInt(process.env.MC_PORT, 10) || 25565;
const MC_USERNAME = process.env.MC_USERNAME || "Voyager-G";
const MC_VERSION  = process.env.MC_VERSION  || "1.20";

/** Creates and returns a connected Mineflayer bot. */
function createBot() {
  logger.info("Bot", "Creating Mineflayer bot...");

  const bot = mineflayer.createBot({
    host: MC_HOST,
    port: MC_PORT,
    username: MC_USERNAME,
    version: MC_VERSION,
    // Keep default error visibility.
    hideErrors: false,
  });

  // Navigation plugin.
  bot.loadPlugin(pathfinder);

  logger.info("Bot", `Bot "${MC_USERNAME}" connecting to ${MC_HOST}:${MC_PORT} (MC ${MC_VERSION})`);

  return bot;
}

module.exports = { createBot };
