/**
 * placeItem.js - Primitive block placement skill.
 *
 * Handles placing a block from inventory into the world and, optionally,
 * picking it back up afterwards (e.g. temporary crafting table placement).
 *
 * This is needed for:
 *   - Placing a crafting table to access 3x3 recipes.
 *   - Placing a furnace to start smelting.
 *   - Any advancement requiring a block to be placed in the world.
 */

const { goals } = require("mineflayer-pathfinder");
const Vec3 = require("vec3").Vec3;

/**
 * Places a block from inventory adjacent to the bot.
 * The block is placed on top of the ground tile one step to the east.
 *
 */
async function placeBlock(bot, mcData, itemName) {
  const itemData = mcData.itemsByName[itemName];
  if (!itemData) throw new Error(`Unknown item: "${itemName}"`);

  const itemInInventory = bot.inventory.items().find((i) => i.name === itemName);
  if (!itemInInventory) throw new Error(`"${itemName}" is not in inventory.`);

  // Pick a placement target: find any adjacent air slot sitting on a solid surface.
  // We test Y-1, Y+0, and Y+1 offsets so the function works in caves, on hillsides,
  // and on flat ground without requiring the surface to be exactly level with the bot.
  const botPos = bot.entity.position.floored();
  const horizontalOffsets = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
  ];
  const yOffsets = [0, 1, -1];

  let ground = null;
  let targetPos = null;

  outer:
  for (const yDelta of yOffsets) {
    for (const [dx, dz] of horizontalOffsets) {
      const pos = botPos.offset(dx, yDelta, dz);
      const below = bot.blockAt(pos.offset(0, -1, 0));
      const at = bot.blockAt(pos);
      if (below && below.boundingBox === "block" && at && at.name === "air") {
        ground = below;
        targetPos = pos;
        break outer;
      }
    }
  }

  if (!ground || !targetPos) {
    throw new Error(`No valid surface found near bot to place "${itemName}".`);
  }

  await bot.equip(itemInInventory, "hand");
  await bot.placeBlock(ground, new Vec3(0, 1, 0));
  await bot.waitForTicks(5);

  return {
    message: `Placed ${itemName} at (${targetPos.x}, ${targetPos.y}, ${targetPos.z}).`,
    position: { x: targetPos.x, y: targetPos.y, z: targetPos.z },
  };
}

/**
 * Places a block and then immediately picks it back up.
 * Useful for temporary placement (e.g. use a crafting table then reclaim it).
 *
 */
async function placeAndReclaim(bot, mcData, itemName, whilePlaced) {
  const { position } = await placeBlock(bot, mcData, itemName);

  // Resolve the actual Block object so the callback can pass it directly
  // to bot.recipesFor() and bot.craft(), which require a Block, not a plain {x,y,z}.
  const placedBlock = bot.blockAt(new Vec3(position.x, position.y, position.z));

  try {
    await whilePlaced(placedBlock);
  } finally {
    // Re-fetch in case the reference became stale during the callback
    const block = bot.blockAt(new Vec3(position.x, position.y, position.z));
    if (block && block.name !== "air") {
      await bot.pathfinder.goto(
        new goals.GoalNear(position.x, position.y, position.z, 1)
      );
      await bot.dig(block);
      await bot.waitForTicks(10);
    }
  }

  return `Used and reclaimed ${itemName}.`;
}

module.exports = { placeBlock, placeAndReclaim };
