/**
 * Observer aggregator.
 * Merges all observation sections into one prompt string.
 */

const { getInventorySummary, getHeldItem } = require("./inventory");
const { getNearbyBlocks, getNearbyInteractiveBlocks, getPosition, getTimeOfDay, getBiome } = require("./environment");
const { getNearbyEntities, getNearbyDroppedItems } = require("./entities");

/** Builds the full text snapshot used by prompts. */
function observe(bot) {
  const sections = [
    "=== AGENT STATE ===",
    `Health: ${bot.health}/20 | Food: ${bot.food}/20 | Experience: level ${bot.experience?.level ?? 0}`,
    getPosition(bot),
    getTimeOfDay(bot),
    getBiome(bot),
    "",
    getHeldItem(bot),
    getInventorySummary(bot),
    "",
    getNearbyBlocks(bot),
    "",
    getNearbyInteractiveBlocks(bot),
    "",
    getNearbyDroppedItems(bot),
    "",
    getNearbyEntities(bot),
  ];

  return sections.join("\n");
}

module.exports = { observe };
