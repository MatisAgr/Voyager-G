/**
 * Smelting helper.
 * Finds/places a furnace, adds input+fuel, waits, then collects output.
 */

const { goals } = require("mineflayer-pathfinder");

const BLOCK_SCAN_RADIUS = parseInt(process.env.BLOCK_SCAN_RADIUS, 10) || 32;

// Fuel priority.
const FUEL_PRIORITY = [
  "coal",
  "charcoal",
  "coal_block",
  "oak_log", "spruce_log", "birch_log", "jungle_log",
  "acacia_log", "dark_oak_log", "mangrove_log",
  "oak_planks", "spruce_planks", "birch_planks",
];

/** Returns the first available fuel item. */
function findFuelInInventory(bot) {
  for (const fuelName of FUEL_PRIORITY) {
    const found = bot.inventory.items().find((i) => i.name === fuelName);
    if (found) return found;
  }
  return null;
}

/** Smelts `count` units of `inputItem` in a furnace. */
async function smeltItem(bot, mcData, inputItem, count = 1) {
  const inputData = mcData.itemsByName[inputItem];
  if (!inputData) throw new Error(`Unknown item to smelt: "${inputItem}"`);

  // Verify we have the item to smelt
  const inputInInventory = bot.inventory.items().find((i) => i.name === inputItem);
  if (!inputInInventory || inputInInventory.count < count) {
    throw new Error(`Not enough "${inputItem}" in inventory (need ${count}, have ${inputInInventory ? inputInInventory.count : 0}).`);
  }

  // Find fuel
  const fuelItem = findFuelInInventory(bot);
  if (!fuelItem) throw new Error("No fuel found in inventory (need coal, charcoal, or wood).");

  // Locate furnace block
  let furnaceBlock = bot.findBlock({
    matching: mcData.blocksByName.furnace.id,
    maxDistance: BLOCK_SCAN_RADIUS,
  });

  // If none nearby, place one from inventory
  if (!furnaceBlock) {
    const furnaceItem = bot.inventory.items().find((i) => i.name === "furnace");
    if (!furnaceItem) throw new Error("No furnace nearby and no furnace in inventory.");

    // Navigate to a safe position to place it
    const pos = bot.entity.position.floored().offset(1, 0, 0);
    const ground = bot.blockAt(pos.offset(0, -1, 0));
    if (!ground) throw new Error("Cannot find ground to place furnace on.");

    await bot.equip(furnaceItem, "hand");
    await bot.placeBlock(ground, new (require("vec3").Vec3)(0, 1, 0));
    await bot.waitForTicks(5);

    furnaceBlock = bot.findBlock({
      matching: mcData.blocksByName.furnace.id,
      maxDistance: BLOCK_SCAN_RADIUS,
    });
    if (!furnaceBlock) throw new Error("Furnace placement failed.");
  }

  // Navigate to furnace
  await bot.pathfinder.goto(
    new goals.GoalNear(furnaceBlock.position.x, furnaceBlock.position.y, furnaceBlock.position.z, 2)
  );

  // Open furnace window
  const furnace = await bot.openFurnace(furnaceBlock);

  try {
    // Load input item
    await furnace.putInput(inputData.id, null, count);

    // Load fuel if the fuel slot is empty
    if (!furnace.fuelItem()) {
      await furnace.putFuel(mcData.itemsByName[fuelItem.name].id, null, Math.max(1, Math.ceil(count / 8)));
    }

    // Wait for each item to smelt (10 seconds per item + buffer)
    const waitTicks = count * 200 + 40; // 200 ticks = 10s per smelt
    await bot.waitForTicks(waitTicks);

    // Collect output
    const output = furnace.outputItem();
    if (output) {
      await furnace.takeOutput();
    }
  } finally {
    furnace.close();
  }

  return `Smelted ${count} ${inputItem}.`;
}

module.exports = { smeltItem };
