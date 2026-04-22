/**
 * Random exploration helper.
 * Moves in random steps until a condition is met or max steps is reached.
 */

const { goals } = require("mineflayer-pathfinder");

/** Explores randomly until conditionFn is true. */
async function exploreUntil(bot, mcData, conditionFn, options = {}) {
  const {
    maxSteps = 15,
    stepDistance = 16,
    targetLabel = "target",
  } = options;

  let steps = 0;

  // Fast path.
  const initialCheck = conditionFn(bot, mcData);
  if (initialCheck) return { found: initialCheck, steps: 0 };

  while (steps < maxSteps) {
    // Random horizontal direction.
    const angle = Math.random() * 2 * Math.PI;
    const dx = Math.round(Math.cos(angle) * stepDistance);
    const dz = Math.round(Math.sin(angle) * stepDistance);

    const target = bot.entity.position.offset(dx, 0, dz);

    try {
      await bot.pathfinder.goto(
        new goals.GoalNear(
          Math.floor(target.x),
          Math.floor(target.y),
          Math.floor(target.z),
          3
        )
      );
    } catch (_) {
      // Ignore unreachable random targets.
    }

    steps++;

    const result = conditionFn(bot, mcData);
    if (result) return { found: result, steps };
  }

  throw new Error(
    `Could not find ${targetLabel} after exploring ${steps} steps (${steps * stepDistance} blocks).`
  );
}

/**
 * Convenience wrapper: explores until a block of the given type is visible.
 *
 */
async function exploreUntilBlock(bot, mcData, blockName, maxDistance = 64, exploreOptions = {}) {
  const blockData = mcData.blocksByName[blockName];
  if (!blockData) throw new Error(`Unknown block: "${blockName}"`);

  const { found } = await exploreUntil(
    bot,
    mcData,
    (b) => b.findBlock({ matching: blockData.id, maxDistance }),
    { targetLabel: blockName, ...exploreOptions }
  );

  return found;
}

/**
 * Convenience wrapper: explores until an entity of the given type is visible.
 *
 */
async function exploreUntilEntity(bot, mcData, entityName, exploreOptions = {}) {
  const { found } = await exploreUntil(
    bot,
    mcData,
    (b) => Object.values(b.entities).find(
      (e) => e.name === entityName && e.position.distanceTo(b.entity.position) < 64
    ),
    { targetLabel: entityName, ...exploreOptions }
  );

  return found;
}

module.exports = { exploreUntil, exploreUntilBlock, exploreUntilEntity };
