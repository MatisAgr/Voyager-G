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
const { countItem } = require("./inventory");

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
 * Pose un bloc a des coordonnees EXACTES (construction de murs/maison).
 * Robuste : se met a portee, choisit un bloc de reference adjacent valide,
 * pose, puis VERIFIE le resultat en ignorant le faux timeout "blockUpdate".
 */
async function placeBlockAt(bot, mcData, itemName, x, y, z) {
  if (!mcData.itemsByName[itemName]) throw new Error(`Unknown item: "${itemName}"`);
  const target = new Vec3(x, y, z);

  // Deja le bon bloc en place ?
  const existing = bot.blockAt(target);
  if (existing && existing.name === itemName) {
    return `${itemName} already at (${x}, ${y}, ${z}).`;
  }
  const replaceable = ["air", "cave_air", "void_air", "water", "lava", "short_grass", "tall_grass", "snow"];
  if (existing && !replaceable.includes(existing.name)) {
    throw new Error(`Target (${x}, ${y}, ${z}) is occupied by ${existing.name}.`);
  }

  // Se rapprocher seulement si hors de portee (evite un pathfind par bloc).
  if (bot.entity.position.distanceTo(target) > 4) {
    try {
      await bot.pathfinder.goto(new goals.GoalNear(x, y, z, 3));
    } catch (_) { /* on tente la pose quand meme */ }
  }

  const item = bot.inventory.items().find((i) => i.name === itemName);
  if (!item) throw new Error(`"${itemName}" is not in inventory.`);
  await bot.equip(item, "hand");

  // bot.placeBlock(ref, face) pose le bloc a ref.position + face.
  // Pour viser `target`, la reference est a (target - face). On essaie le sol d'abord.
  const faces = [
    new Vec3(0, 1, 0),                      // reference dessous -> pose dessus
    new Vec3(1, 0, 0), new Vec3(-1, 0, 0),  // references laterales
    new Vec3(0, 0, 1), new Vec3(0, 0, -1),
    new Vec3(0, -1, 0),                     // reference dessus -> pose dessous
  ];

  let lastErr = null;
  for (const face of faces) {
    const refBlock = bot.blockAt(target.minus(face));
    if (!refBlock || refBlock.boundingBox !== "block") continue;

    try {
      await bot.placeBlock(refBlock, face);
    } catch (e) {
      // "Event blockUpdate did not fire" est souvent un faux echec -> on verifie apres.
      lastErr = e;
    }
    await bot.waitForTicks(3);
    const now = bot.blockAt(target);
    if (now && now.name === itemName) {
      return `Placed ${itemName} at (${x}, ${y}, ${z}).`;
    }
  }

  throw new Error(
    `Could not place ${itemName} at (${x}, ${y}, ${z})` +
    (lastErr ? ` (${lastErr.message})` : " (no adjacent block to place against)") + "."
  );
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

/**
 * Construit une coque de batiment en `itemName` : sol, 4 murs (avec une porte
 * 1x2) et toit optionnel. VERIFIE le stock avant, pose dans l'ordre (sol -> murs
 * -> toit) et renvoie un compte HONNETE (leve une erreur si la pose echoue trop).
 *
 * opts: { width=4, depth=4, height=2, floor=true, roof=true, origin?:{x,y,z} }
 */
async function buildBox(bot, mcData, itemName, opts = {}) {
  if (!mcData.itemsByName[itemName]) throw new Error(`Unknown item: "${itemName}"`);
  const W = opts.width  || 4;   // X
  const D = opts.depth  || 4;   // Z
  const H = opts.height || 2;   // hauteur des murs
  const withFloor = opts.floor !== false;
  const withRoof  = opts.roof  !== false;

  // Coin de depart : decale du bot pour ne pas batir sur lui.
  const p = bot.entity.position.floored();
  const x0 = (opts.origin && opts.origin.x != null) ? opts.origin.x : p.x + 1;
  const y0 = (opts.origin && opts.origin.y != null) ? opts.origin.y : p.y;
  const z0 = (opts.origin && opts.origin.z != null) ? opts.origin.z : p.z + 1;

  // Cibles ordonnees : sol -> murs niveau par niveau -> toit (chaque bloc touche un voisin).
  const targets = [];
  if (withFloor) {
    for (let dx = 0; dx < W; dx++) for (let dz = 0; dz < D; dz++) targets.push(new Vec3(x0 + dx, y0 - 1, z0 + dz));
  }
  const doorX = x0 + Math.floor(W / 2);
  for (let dy = 0; dy < H; dy++) {
    for (let dx = 0; dx < W; dx++) for (let dz = 0; dz < D; dz++) {
      const onEdge = dx === 0 || dx === W - 1 || dz === 0 || dz === D - 1;
      if (!onEdge) continue;
      const isDoor = dz === 0 && (x0 + dx) === doorX && dy < 2; // ouverture 1x2 cote -Z
      if (isDoor) continue;
      targets.push(new Vec3(x0 + dx, y0 + dy, z0 + dz));
    }
  }
  if (withRoof) {
    for (let dx = 0; dx < W; dx++) for (let dz = 0; dz < D; dz++) targets.push(new Vec3(x0 + dx, y0 + H, z0 + dz));
  }

  // Verif stock honnete.
  const have = countItem(bot, mcData, itemName);
  if (have <= 0) throw new Error(`No ${itemName} in inventory to build.`);
  if (have < targets.length) {
    throw new Error(`Not enough ${itemName} to build: need ${targets.length}, have ${have}. Gather more first.`);
  }

  let placed = 0, failed = 0;
  for (const t of targets) {
    try {
      const r = await placeBlockAt(bot, mcData, itemName, t.x, t.y, t.z);
      if (/Placed|already/.test(r)) placed++; else failed++;
    } catch (_) {
      failed++;
    }
  }

  const msg = `Built ${itemName} structure ${W}x${D}x${H}: ${placed} placed, ${failed} failed of ${targets.length}.`;
  if (placed < targets.length * 0.6) throw new Error(`Build mostly failed: ${msg}`);
  return msg;
}

module.exports = { placeBlock, placeBlockAt, buildBox, placeAndReclaim };
