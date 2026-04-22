/**
 * Freeze mode.
 * Keeps the bot idle until a player types "unfreeze".
 */

const logger = require("../utils/logger");

/** Starts freeze mode and waits for the unfreeze command. */
function startFreezeMode(bot, onUnfreeze) {
  logger.info("Freeze", "Freeze mode active. Bot is idle. Say 'unfreeze' in chat to start autonomous training.");
  bot.chat("Freeze mode active. Say 'unfreeze' in chat to start training.");

  function chatListener(username, message) {
    if (message.trim().toLowerCase() === "unfreeze") {
      bot.removeListener("chat", chatListener);
      logger.info("Freeze", `Unfreeze command received from ${username}. Starting autonomous training.`);
      bot.chat("Unfreezing. Starting autonomous training.");
      onUnfreeze();
    }
  }

  bot.on("chat", chatListener);
}

module.exports = { startFreezeMode };
