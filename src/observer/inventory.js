/**
 * Inventory observer.
 * Returns inventory and held-item summaries for prompts.
 */

/** Returns a readable inventory summary. */
function getInventorySummary(bot) {
  const items = bot.inventory.items();

  if (items.length === 0) {
    return "Inventory: empty";
  }

  const lines = items.map(
    (item) => `  - ${item.name} x${item.count}`
  );

  return `Inventory (${items.length} slot(s) used):\n${lines.join("\n")}`;
}

/** Returns the currently held item. */
function getHeldItem(bot) {
  const held = bot.heldItem;
  return held ? `Held item: ${held.name}` : "Held item: none";
}

module.exports = { getInventorySummary, getHeldItem };
