/**
 * Entity observer.
 * Summarizes nearby entities and dropped items.
 */

/** Returns a summary of nearby entities. */
function getNearbyEntities(bot) {
  const radius = parseInt(process.env.ENTITY_SCAN_RADIUS, 10) || 32;
  const entities = Object.values(bot.entities).filter((entity) => {
    if (entity === bot.entity) return false;
    const dist = entity.position.distanceTo(bot.entity.position);
    return dist <= radius;
  });

  if (entities.length === 0) {
    return "Nearby entities: none";
  }

  // Group for readability.
  const groups = {};
  for (const entity of entities) {
    const name = entity.username || entity.displayName || entity.name || "unknown";
    const dist = Math.floor(entity.position.distanceTo(bot.entity.position));
    const key = `${name} (${entity.type})`;
    if (!groups[key]) {
      groups[key] = { count: 0, closestDist: dist };
    }
    groups[key].count += 1;
    if (dist < groups[key].closestDist) {
      groups[key].closestDist = dist;
    }
  }

  const lines = Object.entries(groups).map(
    ([key, { count, closestDist }]) =>
      `  - ${key}: ${count} (closest ${closestDist}m)`
  );

  return `Nearby entities (radius ${radius}):\n${lines.join("\n")}`;
}

/** Returns a summary of nearby dropped items. */
function getNearbyDroppedItems(bot) {
  const radius = 16;
  const items = [];

  for (const entity of Object.values(bot.entities)) {
    if (entity === bot.entity) continue;
    if (entity.name !== "item") continue;
    const dist = Math.round(entity.position.distanceTo(bot.entity.position));
    if (dist > radius) continue;

    let itemName = "unknown";
    try {
      const meta = entity.metadata;
      const slot = meta && meta[7];
      if (slot && slot.name) itemName = slot.name;
      else if (slot && slot.itemName) itemName = slot.itemName;
    } catch (_) {}

    items.push({ itemName, dist });
  }

  if (items.length === 0) return "Dropped items nearby: none";

  // Merge same item names.
  const merged = {};
  for (const { itemName, dist } of items) {
    if (!merged[itemName]) merged[itemName] = { count: 0, closestDist: dist };
    merged[itemName].count += 1;
    if (dist < merged[itemName].closestDist) merged[itemName].closestDist = dist;
  }

  const lines = Object.entries(merged).map(
    ([name, { count, closestDist }]) =>
      `  - ${name} x${count} (${closestDist}m away) — walk over it to pick it up`
  );

  return `Dropped items nearby (radius 16m):\n${lines.join("\n")}`;
}

module.exports = { getNearbyEntities, getNearbyDroppedItems };
