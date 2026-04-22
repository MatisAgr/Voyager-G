/**
 * navigation.js - Primitive navigation skills.
 *
 * Uses mineflayer-pathfinder to provide simple movement primitives.
 */

const { goals } = require("mineflayer-pathfinder");

/**
 * Moves the bot to the given XYZ coordinates.
 *
 */
async function goTo(bot, x, y, z) {
  const goal = new goals.GoalBlock(x, y, z);
  await bot.pathfinder.goto(goal);
  return `Moved to (${x}, ${y}, ${z})`;
}

/**
 * Moves the bot near a specific entity.
 *
 */
async function goToEntity(bot, entity, range = 2) {
  const goal = new goals.GoalNear(
    entity.position.x,
    entity.position.y,
    entity.position.z,
    range
  );
  await bot.pathfinder.goto(goal);
  return `Moved near entity at (${Math.floor(entity.position.x)}, ${Math.floor(entity.position.y)}, ${Math.floor(entity.position.z)})`;
}

module.exports = { goTo, goToEntity };
