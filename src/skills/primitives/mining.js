/**
 * mining.js - Primitive mining skills.
 *
 * These are hand-written baseline skills that the agent can call
 * without needing LLM-generated code. They serve as building blocks
 * and fallback actions when the LLM struggles with low-level API calls.
 */

const { goals } = require("mineflayer-pathfinder");

/**
 * Mines the nearest block of the given type.
 *
 */
async function mineBlock(bot, mcData, blockName) {
  const blockType = mcData.blocksByName[blockName];
  if (!blockType) {
    throw new Error(`Unknown block type: "${blockName}"`);
  }

  const block = bot.findBlock({
    matching: blockType.id,
    maxDistance: 64,
  });

  if (!block) {
    throw new Error(`No "${blockName}" found within 64 blocks`);
  }

  // Navigate close enough to mine
  await bot.pathfinder.goto(new goals.GoalBlock(block.position.x, block.position.y, block.position.z));

  // Dig the block
  await bot.dig(block);

  return `Mined 1 ${blockName} at ${block.position}`;
}

module.exports = { mineBlock };
