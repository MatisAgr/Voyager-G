/**
 * crafting.js - Primitive crafting skills.
 *
 * Provides basic crafting helpers so the LLM does not have to
 * re-derive the Mineflayer crafting API every time.
 */

/**
 * Crafts a given item if possible. Automatically walks to the
 * nearest crafting table when a table is required.
 *
 */
async function craftItem(bot, mcData, itemName, count = 1) {
  const item = mcData.itemsByName[itemName];
  if (!item) {
    throw new Error(`Unknown item: "${itemName}"`);
  }

  // Find applicable recipes
  const recipes = bot.recipesFor(item.id, null, 1, null);

  if (recipes.length === 0) {
    // Maybe a crafting table is needed
    const craftingTable = bot.findBlock({
      matching: mcData.blocksByName.crafting_table.id,
      maxDistance: 32,
    });

    if (craftingTable) {
      const tableRecipes = bot.recipesFor(item.id, null, 1, craftingTable);
      if (tableRecipes.length === 0) {
        throw new Error(`No recipe found for "${itemName}" even with crafting table`);
      }
      await bot.craft(tableRecipes[0], count, craftingTable);
      return `Crafted ${count} ${itemName} using nearby crafting table`;
    }

    throw new Error(`No recipe found for "${itemName}". Missing ingredients or crafting table.`);
  }

  await bot.craft(recipes[0], count, null);
  return `Crafted ${count} ${itemName}`;
}

module.exports = { craftItem };
