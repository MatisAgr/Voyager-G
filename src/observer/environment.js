/**
 * Environment observer.
 * Summarizes nearby blocks, position, time, and biome.
 */

/** Returns nearby block counts. */
function getNearbyBlocks(bot) {
  const radius = parseInt(process.env.BLOCK_SCAN_RADIUS, 10) || 16;
  const pos = bot.entity.position;
  const blockCounts = {};

  for (let x = -radius; x <= radius; x++) {
    for (let y = -radius; y <= radius; y++) {
      for (let z = -radius; z <= radius; z++) {
        const block = bot.blockAt(pos.offset(x, y, z));
        if (block && block.name !== "air") {
          blockCounts[block.name] = (blockCounts[block.name] || 0) + 1;
        }
      }
    }
  }

  // Keep top block types only.
  const sorted = Object.entries(blockCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  if (sorted.length === 0) {
    return "Nearby blocks: none detected";
  }

  const lines = sorted.map(([name, count]) => `  - ${name}: ${count}`);
  return `Nearby blocks (radius ${radius}):\n${lines.join("\n")}`;
}

/** Returns current position. */
function getPosition(bot) {
  const pos = bot.entity.position;
  return `Position: x=${Math.floor(pos.x)}, y=${Math.floor(pos.y)}, z=${Math.floor(pos.z)}`;
}

/** Returns time of day. */
function getTimeOfDay(bot) {
  const time = bot.time.timeOfDay;
  let phase;
  if (time < 6000) phase = "morning";
  else if (time < 12000) phase = "afternoon";
  else if (time < 18000) phase = "night";
  else phase = "late night";
  return `Time of day: ${time} ticks (${phase})`;
}

/** Returns current biome. */
function getBiome(bot) {
  try {
    const biome = bot.blockAt(bot.entity.position)?.biome?.name;
    return biome ? `Biome: ${biome}` : "Biome: unknown";
  } catch {
    return "Biome: unknown";
  }
}

// Known interactive blocks to report with coordinates.
const INTERACTIVE_BLOCKS = new Set([
  "crafting_table", "furnace", "blast_furnace", "smoker",
  "chest", "trapped_chest", "barrel",
  "anvil", "chipped_anvil", "damaged_anvil",
  "enchanting_table", "grindstone", "smithing_table",
  "loom", "cartography_table", "fletching_table",
  "brewing_stand", "cauldron",
  "bed", "respawn_anchor",
]);

/** Returns nearby interactive blocks with coordinates. */
function getNearbyInteractiveBlocks(bot) {
  const radius = 16;
  const pos = bot.entity.position;
  const found = [];

  for (let x = -radius; x <= radius; x++) {
    for (let y = -radius; y <= radius; y++) {
      for (let z = -radius; z <= radius; z++) {
        const block = bot.blockAt(pos.offset(x, y, z));
        if (block && INTERACTIVE_BLOCKS.has(block.name)) {
          const dist = Math.round(Math.sqrt(x * x + y * y + z * z));
          found.push({
            name: block.name,
            x: Math.floor(block.position.x),
            y: Math.floor(block.position.y),
            z: Math.floor(block.position.z),
            dist,
          });
        }
      }
    }
  }

  if (found.length === 0) return "Nearby interactive blocks: none";

  found.sort((a, b) => a.dist - b.dist);
  const lines = found.map(
    b => `  - ${b.name} at (${b.x}, ${b.y}, ${b.z}) — ${b.dist}m away`
  );
  return `Nearby interactive blocks (radius ${radius}m):\n${lines.join("\n")}`;
}

module.exports = { getNearbyBlocks, getNearbyInteractiveBlocks, getPosition, getTimeOfDay, getBiome };
