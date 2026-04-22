/**
 * combat.js - Primitive combat skills.
 *
 * Provides basic attack / flee helpers. These are intentionally
 * simple; the LLM can compose more advanced combat strategies
 * on top of these primitives.
 */

const { goals } = require("mineflayer-pathfinder");

/**
 * Attacks the nearest hostile mob within range.
 *
 */
async function attackNearest(bot, range = 16) {
  const hostileTypes = ["zombie", "skeleton", "spider", "creeper", "enderman"];

  const entity = bot.nearestEntity((e) => {
    if (!e.name) return false;
    if (e.position.distanceTo(bot.entity.position) > range) return false;
    return hostileTypes.includes(e.name);
  });

  if (!entity) {
    return "No hostile mob nearby to attack";
  }

  // Move close enough
  const goal = new goals.GoalNear(
    entity.position.x,
    entity.position.y,
    entity.position.z,
    2
  );
  await bot.pathfinder.goto(goal);

  // Attack
  await bot.attack(entity);

  return `Attacked ${entity.name} at (${Math.floor(entity.position.x)}, ${Math.floor(entity.position.y)}, ${Math.floor(entity.position.z)})`;
}

/**
 * Runs away from the nearest entity by moving in the opposite direction.
 *
 */
async function flee(bot, distance = 20) {
  const nearest = bot.nearestEntity();
  if (!nearest) return "No entity to flee from";

  const direction = bot.entity.position.minus(nearest.position).normalize();
  const target = bot.entity.position.plus(direction.scaled(distance));

  const goal = new goals.GoalBlock(
    Math.floor(target.x),
    Math.floor(target.y),
    Math.floor(target.z)
  );
  await bot.pathfinder.goto(goal);

  return `Fled ${distance} blocks from ${nearest.name || "entity"}`;
}

/**
 * Waits until an entity (identified by its Mineflayer entity object) is
 * no longer present in the loaded world, or until the timeout expires.
 *
 * Useful after killing a mob to confirm the death before moving on,
 * preventing the bot from trying to loot before the mob has despawned.
 *
 */
async function waitForMobRemoved(bot, entity, timeoutMs = 10000) {
  const entityId = entity.id;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (!bot.entities[entityId]) return `Entity ${entity.name || entityId} removed.`;
    await new Promise((r) => setTimeout(r, 250));
  }

  throw new Error(`Entity ${entity.name || entityId} was not removed within ${timeoutMs}ms.`);
}

module.exports = { attackNearest, flee, waitForMobRemoved };
