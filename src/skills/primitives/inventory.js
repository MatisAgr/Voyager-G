/**
 * Inventory primitives.
 * Helpers to inspect inventory and equip items/tools.
 */

/** Returns a compact inventory summary string. */
function getInventorySummary(bot) {
  const items = bot.inventory.items();
  if (items.length === 0) return "Inventory is empty.";
  return "Inventory: " + items.map((i) => `${i.name} x${i.count}`).join(", ");
}

/** Returns inventory items as structured objects. */
function getInventoryItems(bot) {
  return bot.inventory.items().map((i) => ({
    name: i.name,
    count: i.count,
    type: i.type,
  }));
}

/** Returns the count of one item in inventory. */
function countItem(bot, mcData, itemName) {
  const itemData = mcData.itemsByName[itemName];
  if (!itemData) return 0;
  const found = bot.inventory.items().find((i) => i.type === itemData.id);
  return found ? found.count : 0;
}

/** Equips one inventory item in hand. */
async function equipItem(bot, mcData, itemName) {
  const itemData = mcData.itemsByName[itemName];
  if (!itemData) throw new Error(`Unknown item: "${itemName}"`);

  const inInventory = bot.inventory.items().find((i) => i.type === itemData.id);
  if (!inInventory) throw new Error(`"${itemName}" is not in the inventory.`);

  await bot.equip(inInventory, "hand");
  return `Equipped ${itemName} in hand.`;
}

/**
 * Equips the best available pickaxe from the bot's inventory.
 * Priority: netherite > diamond > iron > stone > golden > wooden.
 * Throws if no pickaxe is found at all.
 *
 */
async function equipBestPickaxe(bot, mcData) {
  const tiers = [
    "netherite_pickaxe",
    "diamond_pickaxe",
    "iron_pickaxe",
    "stone_pickaxe",
    "golden_pickaxe",
    "wooden_pickaxe",
  ];

  for (const name of tiers) {
    const itemData = mcData.itemsByName[name];
    if (!itemData) continue;
    const inInventory = bot.inventory.items().find((i) => i.type === itemData.id);
    if (inInventory) {
      await bot.equip(inInventory, "hand");
      return `Equipped ${name}.`;
    }
  }

  throw new Error("No pickaxe found in inventory.");
}

/**
 * Equips the best available sword from the bot's inventory.
 * Priority: netherite > diamond > iron > stone > golden > wooden.
 *
 */
async function equipBestSword(bot, mcData) {
  const tiers = [
    "netherite_sword",
    "diamond_sword",
    "iron_sword",
    "stone_sword",
    "golden_sword",
    "wooden_sword",
  ];

  for (const name of tiers) {
    const itemData = mcData.itemsByName[name];
    if (!itemData) continue;
    const inInventory = bot.inventory.items().find((i) => i.type === itemData.id);
    if (inInventory) {
      await bot.equip(inInventory, "hand");
      return `Equipped ${name}.`;
    }
  }

  throw new Error("No sword found in inventory.");
}

/**
 * Checks whether the bot has at least `count` of the given item.
 *
 */
function hasItem(bot, mcData, itemName, count = 1) {
  return countItem(bot, mcData, itemName) >= count;
}

module.exports = {
  getInventorySummary,
  getInventoryItems,
  countItem,
  hasItem,
  equipItem,
  equipBestPickaxe,
  equipBestSword,
};
