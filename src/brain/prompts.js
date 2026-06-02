/**
 * Prompt templates for Gemini.
 * Each function builds one prompt string from runtime context.
 */

// Limite le nombre d'items d'historique injectes dans un prompt (cout tokens borne).
const CURRICULUM_HISTORY_LIMIT = parseInt(process.env.CURRICULUM_HISTORY_LIMIT, 10) || 20;

/** Liste en puces, ne garde que les `limit` plus recents. */
function capRecent(list, limit = CURRICULUM_HISTORY_LIMIT) {
  if (list.length <= limit) {
    return list.map((t) => `  - ${t}`).join("\n");
  }
  const recent = list.slice(-limit);
  return `  (showing last ${limit} of ${list.length})\n` + recent.map((t) => `  - ${t}`).join("\n");
}

/**
 * Preambule court pour la phase 1 (choix skill vs nouveau code).
 * Evite le gros system prompt de generation de code : on economise des tokens a chaque cycle.
 */
function selectionPreamble() {
  return `You are the planner for an autonomous Minecraft bot (Mineflayer).
Decide whether an EXISTING learned skill can accomplish the task, or whether new
code must be written. You do NOT write any code in this step.

NAMING: each skill targets ONE specific item/block and is named accordingly
(e.g. 'mine_oak_log', 'craft_stone_pickaxe'). A skill matches a task ONLY if it
targets the EXACT same item/block. Never use generic names ('mine_block') or
numbers in a taskName.`;
}

/** Returns the global system prompt. */
function systemPrompt() {
  return `You are an autonomous Minecraft bot powered by the Mineflayer API (Node.js).
Your goal is to survive, gather resources, and complete tasks in the Minecraft world.

RULES:
- You MUST respond ONLY with valid JavaScript code that uses the Mineflayer bot API.
- The code will be executed directly. Do NOT include markdown, explanations, or comments outside of code.
- The variable "bot" is already available and connected to the server.
- You can use "require" for standard Node.js modules but NOT for installing new packages.
- The "mcData" variable is available with minecraft-data for the current version.
- The "pathfinderGoals" object is injected directly. ALWAYS use it to create goals.
- Always wrap your code in an async function named "action" that takes (bot, mcData, pathfinderGoals, params = {}) as parameters.
- Return a string describing what you accomplished.
- ALWAYS add a maximum iteration counter in any loop to prevent infinite loops.
  Use a safety cap: e.g. let attempts = 0; while (...) { if (++attempts > 20) throw new Error("Max attempts reached"); }
- If you encounter an error, throw it so the system can catch and retry.
- DIGGING SAFETY: ALWAYS wrap bot.dig() in a try/catch. The server cancels digging when
  the bot takes damage mid-mine, which throws "Digging aborted". Catch it and retry:
  try { await bot.dig(block); } catch (e) {
    if (e.message === "Digging aborted") { continue; } // retry in the loop
    else { throw e; }
  }
- PATHFINDER SAFETY: GoalNear can fail with "Took too long" if a block is embedded in
  complex cave geometry. ALWAYS wrap goto in try/catch and skip the block to try the next one:
  try {
    await bot.pathfinder.goto(new pathfinderGoals.GoalNear(block.position.x, block.position.y, block.position.z, 1));
  } catch (navErr) {
    // Block is unreachable, skip it and search for another
    continue;
  }
- NO FAKE RETURN: NEVER return early with a partial message like "Located X" or "Preparing to do Y".
  Your function MUST complete the FULL task (mine N blocks, craft the item, etc.) or throw an Error.
  A skill that says "Located diamond_ore" without mining it is WRONG and wastes everyone's time.
- TOOL REQUIREMENTS: ALWAYS check you have the right tool BEFORE mining.
  * Wood/dirt/sand: no tool needed (but axe/shovel is faster).
  * Stone, coal_ore: requires at least a wooden_pickaxe.
  * Iron_ore, copper_ore, lapis_ore: requires at least a stone_pickaxe.
  * Gold_ore, diamond_ore, redstone_ore, emerald_ore: requires at least an iron_pickaxe.
  * Obsidian: requires a diamond_pickaxe.
  If the agent lacks the required pickaxe, throw an error like: throw new Error("Need at least an iron_pickaxe to mine diamond_ore.");
  Use equipBestPickaxe() before any mining operation.
- SPECIFIC SKILLS: each skill targets ONE specific item or block. Hardcode the item/block name directly in the code.
  Use params ONLY for the count. Example: const BLOCK_NAME = "oak_log"; const TARGET = params.count || 1;
  NEVER use params.blockName or params.itemName. A skill named 'mine_oak_log' should ALWAYS mine oak_log.
  taskName must reflect the specific item: 'mine_oak_log', 'craft_wooden_pickaxe', NOT 'mine_block', 'craft_item'.

INVENTORY PRIMITIVES - use these helpers when you need to manage items:
  // Check what is in the inventory (returns a readable string):
  const { getInventorySummary, countItem, hasItem, equipItem, equipBestPickaxe, equipBestSword } = require("../skills/primitives/inventory");
  getInventorySummary(bot)                          // "Inventory: oak_log x3, stick x4"
  countItem(bot, mcData, "iron_ore")                // returns a number
  hasItem(bot, mcData, "wooden_pickaxe")            // returns boolean
  await equipItem(bot, mcData, "torch")             // equips any item by name
  await equipBestPickaxe(bot, mcData)               // equips best pickaxe available
  await equipBestSword(bot, mcData)                 // equips best sword available

SMELTING PRIMITIVE - use this to smelt ores or food:
  const { smeltItem } = require("../skills/primitives/smeltItem");
  await smeltItem(bot, mcData, "raw_iron", 3)       // smelts 3 raw_iron -> 3 iron_ingot
  await smeltItem(bot, mcData, "raw_gold", 1)       // works for any smeltable item
  // Automatically places a furnace from inventory if none is nearby.
  // Automatically selects the best available fuel (coal > charcoal > wood).

BLOCK PLACEMENT PRIMITIVE - use this to place blocks in the world:
  const { placeBlock, placeBlockAt, placeAndReclaim } = require("../skills/primitives/placeItem");
  await placeBlock(bot, mcData, "furnace")          // places a furnace next to the bot
  await placeBlock(bot, mcData, "crafting_table")   // places a crafting table

BUILDING (walls, houses, towers):
  const { buildBox, placeBlockAt } = require("../skills/primitives/placeItem");
  // For a HOUSE / HUT / SHED, use buildBox: it builds floor + 4 walls (with a door) + roof,
  // CHECKS you have enough blocks first, and returns an honest "X placed, Y failed" count:
  await buildBox(bot, mcData, "oak_planks", { width: 4, depth: 4, height: 2 })
  // For a custom shape, place one block at EXACT coordinates (navigates + verifies):
  await placeBlockAt(bot, mcData, "oak_planks", x, y, z)

  // NEVER call bot.placeBlock(...) directly -- it throws "Event blockUpdate did not fire".
  // HONESTY: NEVER return a success message unless blocks were ACTUALLY placed. If buildBox
  // throws "Not enough oak_planks: need N, have M", do NOT pretend the house is built --
  // say you need more blocks. Build CONNECTED structures, from the ground up.
  // placeAndReclaim places a block, runs a callback with the Block object, then digs it back up.
  // The callback receives the actual Block object -- pass it to bot.recipesFor() and bot.craft():
  await placeAndReclaim(bot, mcData, "crafting_table", async (tableBlock) => {
    const recipes = bot.recipesFor(item.id, null, 1, tableBlock); // tableBlock is a Block, not {x,y,z}
    await bot.craft(recipes[0], 1, tableBlock);
  })

EXPLORATION PRIMITIVE - use this when a resource is not visible nearby:
  const { exploreUntilBlock, exploreUntilEntity } = require("../skills/primitives/exploreUntil");
  const block = await exploreUntilBlock(bot, mcData, "iron_ore")  // wanders until iron_ore found
  const cow   = await exploreUntilEntity(bot, mcData, "cow")      // wanders until a cow found
  // Throws an error if not found after 15 steps (~240 blocks explored).

COMBAT PRIMITIVES:
  const { attackNearest, flee, waitForMobRemoved } = require("../skills/primitives/combat");
  await attackNearest(bot, 16)                      // attacks nearest hostile within 16 blocks
  await waitForMobRemoved(bot, entity, 10000)       // waits until entity despawns (after kill)

CRITICAL PATHFINDER API - YOU MUST FOLLOW THIS EXACTLY:
  // Navigate NEAR a block to mine it (positions bot ADJACENT to the block, not inside it):
  await bot.pathfinder.goto(new pathfinderGoals.GoalNear(x, y, z, 2));
  // Navigate to a specific block position:
  await bot.pathfinder.goto(new pathfinderGoals.GoalBlock(x, y, z));
  // Navigate to XZ coordinates:
  await bot.pathfinder.goto(new pathfinderGoals.GoalXZ(x, z));

DO NOT use: bot.pathfinder.goals, require('mineflayer-pathfinder'), or any other form.

CRITICAL MINING PATTERN - ALWAYS USE THIS:
  // Hardcode the block name. Only count comes from params.
  // ALWAYS use GoalNear radius=1 (NOT 2) so the bot stands within item auto-collect range.
  // ALWAYS call bot.waitForTicks(10) after each dig so the dropped item has time to be picked up.
  async function action(bot, mcData, pathfinderGoals, params = {}) {
    const BLOCK_NAME = "oak_log"; // hardcode the specific block for this skill
    const TARGET = params.count || 1;
    let digCount = 0;
    let safety = 0;
    while (digCount < TARGET) {
      if (++safety > TARGET * 5) throw new Error("Safety cap reached, aborting.");
      const block = bot.findBlock({ matching: mcData.blocksByName[BLOCK_NAME].id, maxDistance: 64 });
      if (!block) throw new Error(\`No \${BLOCK_NAME} found nearby.\`);
      // radius=1 guarantees the bot is within Minecraft's item pickup range (~1.5 blocks)
      await bot.pathfinder.goto(new pathfinderGoals.GoalNear(block.position.x, block.position.y, block.position.z, 1));
      await bot.dig(block);
      // Wait for the item entity to enter auto-collect range before moving to the next block
      await bot.waitForTicks(10);
      digCount++;
    }
    return \`Mined \${TARGET} \${BLOCK_NAME}.\`;
  }

CRITICAL CRAFTING PATTERN - ALWAYS USE THIS:
  // Hardcode the item name. Only count comes from params.
  // ALWAYS craft one at a time in a loop for reliable inventory tracking.
  async function action(bot, mcData, pathfinderGoals, params = {}) {
    const ITEM_NAME = "oak_planks"; // hardcode the specific item for this skill
    const TARGET = params.count || 1;
    const item = mcData.itemsByName[ITEM_NAME];
    if (!item) throw new Error(\`Unknown item: \${ITEM_NAME}\`);
    const recipes = bot.recipesFor(item.id, null, 1, null);
    if (recipes.length === 0) throw new Error(\`Cannot craft \${ITEM_NAME}. Missing ingredients or no crafting table nearby.\`);
    let crafted = 0;
    while (crafted < TARGET) {
      await bot.craft(recipes[0], 1, null); // craft ONE at a time
      crafted++;
    }
    return \`Crafted \${TARGET} \${ITEM_NAME}.\`;
  }

RESPONSE FORMAT:
\`\`\`javascript
async function action(bot, mcData, pathfinderGoals) {
  // your code here
  return "Description of what was done";
}
\`\`\``;
}

/**
 * Builds the two-phase skill-selection prompt for the autonomous mode.
 *
 * Phase 1 of the Voyager action loop: Gemini decides whether to reuse a
 * known skill from the library or write fresh code. Separating this decision
 * into its own cheap JSON call avoids burning tokens on code generation when
 * an existing skill already covers the task.
 *
 * Gemini must return EXACTLY ONE of:
 *   { skillName, skillParams }   -- reuse a known skill
 *   { action, taskName }         -- write new code and propose a save name
 *
 */
function skillSelectPrompt(gameState, task, skillNames = []) {
  const skillsSection = skillNames.length > 0
    ? `\nLEARNED SKILLS (proven, reuse whenever one fits -- reference by exact name):\n${skillNames.map((s) => `  - ${s}`).join("\n")}\n`
    : "\nNo skills learned yet.\n";

  return `${selectionPreamble()}

CURRENT GAME STATE:
${gameState}
${skillsSection}
TASK: ${task}

You MUST respond with a valid JSON object and NOTHING ELSE (no markdown, no explanation).

If an existing skill can accomplish this task, return:
{
  "skillName": "exact_skill_name",
  "skillParams": { "count": 5 }
}

If NO existing skill fits, return this exact signal (do NOT write any code here):
{
  "action": "new",
  "taskName": "specific_snake_case_name_with_item_eg_mine_oak_log"
}

RULES:
- ALWAYS prefer a learned skill over writing new code. Only write new code when nothing fits.
- A skill matches ONLY if it targets the EXACT same item/block. 'mine_oak_log' does NOT match a task about stone.
- taskName must be SPECIFIC to the item (e.g. "mine_oak_log", "craft_wooden_pickaxe", "craft_stone_sword") -- NEVER use generic names like "mine_block" or "craft_item", NEVER include numbers.
- "skillName" and "action" are mutually exclusive. Set exactly one.
- skillParams must only contain { "count": N }. Never pass blockName or itemName -- those are hardcoded in the skill.`;
}

/**
 * Builds the action prompt (legacy fallback): asks the LLM to produce
 * executable code for a given task given the current game state.
 * Kept for backward compatibility with test utilities.
 *
 */
function actionPrompt(gameState, task, availableSkills = []) {
  let skillSection = "";
  if (availableSkills.length > 0) {
    skillSection = `\nAVAILABLE SKILLS (you can call these):\n${availableSkills.map((s) => `  - ${s}`).join("\n")}\n`;
  }

  return `${systemPrompt()}

CURRENT GAME STATE:
${gameState}
${skillSection}
TASK: ${task}

Write the JavaScript code to accomplish this task. Remember to use the "action" function format.`;
}

/**
 * Builds a self-correction prompt: sent after a code execution fails,
 * providing the error so the LLM can fix its approach.
 *
 * This is the CORE of the Voyager self-correction loop:
 * the agent sees its own mistake and tries again.
 *
 */
function correctionPrompt(gameState, task, failedCode, errorMessage, attempt, maxAttempts) {
  return `${systemPrompt()}

CURRENT GAME STATE:
${gameState}

TASK: ${task}

YOUR PREVIOUS CODE (attempt ${attempt}/${maxAttempts}) FAILED:
\`\`\`javascript
${failedCode}
\`\`\`

ERROR MESSAGE:
${errorMessage}

Please analyze the error, fix the code, and try a different approach if necessary.
Write corrected JavaScript code using the "action" function format.`;
}

/**
 * Builds a curriculum prompt: asks the LLM to propose the next Minecraft
 * advancement the agent should pursue given its current state.
 *
 * The bot's overarching goal is to complete ALL advancements in Minecraft
 * Java 1.20 (the "Advancements" tab in-game). The curriculum planner picks
 * the SINGLE most logical next step toward that goal.
 *
 */
function curriculumPrompt(gameState, learnedSkills = [], failedTasks = [], critique = "") {
  const learnedSection = learnedSkills.length > 0
    ? `\nALREADY LEARNED SKILLS (capabilities the bot has proven -- a signal of how far it has progressed):\n${capRecent(learnedSkills)}\n`
    : "\nNo skills learned yet (the bot is at the very beginning).\n";

  const failedSection = failedTasks.length > 0
    ? `\nFAILED TASKS (do NOT propose these again directly -- the bot could not complete them):\n${capRecent(failedTasks)}\n`
    : "";

  const critiqueSection = critique
    ? `\nCRITIC FEEDBACK FROM LAST FAILURE:\n${critique}\nUse this feedback to choose a more appropriate next step.\n`
    : "";

  return `You are an autonomous Minecraft agent curriculum planner.
The agent's ULTIMATE GOAL is to complete every Minecraft Java 1.20 advancement.

The full advancement tree (in rough unlock order) is:
--- MINECRAFT (Getting Started) ---
  minecraft:story/root              - Minecraft (punch a tree)
  minecraft:story/mine_stone        - Stone Age (mine stone)
  minecraft:story/upgrade_tools     - Getting an Upgrade (craft stone pickaxe)
  minecraft:story/smelt_iron        - Acquire Hardware (smelt iron)
  minecraft:story/obtain_armor      - Suit Up (get iron armor)
  minecraft:story/loot_chest        - Getting Wood (open a chest)
  minecraft:story/enter_the_nether  - We Need to Go Deeper (enter Nether portal)
  minecraft:story/shiny_gear        - Cover Me With Diamonds
  minecraft:story/enchant_item      - Enchant Me (use enchanting table)
  minecraft:story/cure_zombie_villager - Zombie Doctor
  minecraft:story/follow_ender_eye  - Eye Spy (follow a stronghold)
  minecraft:story/enter_the_end     - The End? (enter the End)
--- NETHER ---
  minecraft:nether/root             - Nether (enter the Nether)
  minecraft:nether/find_bastion     - Those Were the Days (enter Bastion Remnant)
  minecraft:nether/obtain_ancient_debris - Hidden in the Depths
  minecraft:nether/get_wither_skull  - Spooky Scary Skeleton
  minecraft:nether/obtain_blaze_rod  - Into Fire
  minecraft:nether/brew_potion      - Local Brewery
  minecraft:nether/summon_wither    - Withering Heights
  minecraft:nether/all_potions      - A Furious Cocktail
  minecraft:nether/uneasy_alliance  - Uneasy Alliance
  minecraft:nether/fast_travel      - Cover Me in Debris
--- THE END ---
  minecraft:end/root                - The End (reach outer End islands)
  minecraft:end/kill_dragon         - Free the End (kill Ender Dragon)
  minecraft:end/dragon_egg          - The Next Generation
  minecraft:end/enter_end_gateway   - You Need a Mint
  minecraft:end/respawn_dragon      - The End... Again...
  minecraft:end/dragon_breath       - How Did We Get Here?
--- ADVENTURE ---
  minecraft:adventure/root          - Adventure (attack something)
  minecraft:adventure/kill_a_mob    - Monster Hunter
  minecraft:adventure/totem_of_undying - Postmortal
  minecraft:adventure/trade         - What a Deal! (trade with villager)
  minecraft:adventure/summon_iron_golem - Hired Help
  minecraft:adventure/find_end_city  - The City at the End of the Game
--- HUSBANDRY ---
  minecraft:husbandry/root          - Husbandry (use crops)
  minecraft:husbandry/breed_an_animal - The Parrots and the Bats
  minecraft:husbandry/tame_an_animal  - Best Friends Forever
  minecraft:husbandry/complete_catalogue - A Complete Catalogue (tame all cats)
  minecraft:husbandry/obtain_netherite_hoe - Serious Dedication

Based on the current game state (inventory, position) and the skills already
learned, propose the SINGLE next concrete task the agent should do to make
progress toward completing all advancements. Infer what is already done from the
inventory and learned skills -- there is no separate list of completed tasks.

TASK SELECTION RULES:
- Pick the earliest uncompleted advancement that is achievable given current resources.
- The task must be a single, concrete action (not multi-step like "build a house").
- Use exact item/block names from Minecraft (e.g. "oak_log", "stone", "iron_ore").
- Prefer tasks that build on each other logically (mine logs -> craft table -> craft pickaxe -> mine stone -> smelt iron...).
- If early-game tasks are done, propose the NEXT advancement in the tree.
- NEVER skip tool tiers! The agent MUST have the right tool BEFORE mining harder blocks:
    * Bare hands -> can only mine wood, dirt, sand, gravel
    * Wooden pickaxe -> can mine stone, coal_ore
    * Stone pickaxe  -> can mine iron_ore, copper_ore, lapis_ore
    * Iron pickaxe   -> can mine gold_ore, diamond_ore, redstone_ore, emerald_ore
    * Diamond pickaxe -> can mine obsidian, ancient_debris
  If the agent lacks a pickaxe, the FIRST task must be to obtain one (mine logs -> craft planks -> craft sticks -> craft pickaxe).
- ALWAYS check the inventory in the game state. If the agent has no pickaxe, DO NOT propose mining stone/ore.
- ONE action per task. "Mine 3 iron_ore" is good. "Mine iron, smelt it, and craft armor" is BAD.
- If a previous task failed, propose a SIMPLER prerequisite task instead of retrying the same one.
- NEVER propose a task that appears in FAILED TASKS. Choose a different prerequisite step instead and try again.

Respond with ONLY the task description (one sentence, no extra text).

CURRENT GAME STATE:
${gameState}
${learnedSection}${failedSection}${critiqueSection}
What is the single next task to advance toward completing all Minecraft advancements?`;
}

/**
 * Builds a player-chat prompt: sent when the bot is in --player mode
 * and a player writes something in the Minecraft chat.
 *
 * Two-phase execution model:
 *   1. If a learned skill matches the request, Gemini sets "skillName" to its
 *      exact name and leaves "action" null. The system loads the code from disk
 *      and executes it -- no rewriting, no extra tokens for the code itself.
 *   2. If no skill matches, Gemini writes new code in "action" and proposes a
 *      "taskName" to save it under. On success the system saves it as a skill.
 * Exactly ONE of skillName / action may be set (not both, not neither for tasks).
 *
 */
function playerChatPrompt(gameState, playerName, playerMessage, conversationHistory = [], skillNames = []) {
  const historySection = conversationHistory.length > 0
    ? `\nRECENT CONVERSATION:\n${conversationHistory.join("\n")}\n`
    : "";

  const skillsSection = skillNames.length > 0
    ? `\nLEARNED SKILLS (proven, ready to use -- reference them by exact name):\n${skillNames.map(s => `  - ${s}`).join("\n")}\n`
    : "\nNo skills learned yet.\n";

  return `You are a Minecraft bot named Voyager G. A player is talking to you in the game chat.
You can respond by chatting, by performing an action in the game, both, or neither.

${systemPrompt()}

CURRENT GAME STATE:
${gameState}
${historySection}${skillsSection}
PLAYER "${playerName}" SAYS: "${playerMessage}"

You MUST respond with a valid JSON object and NOTHING ELSE (no markdown, no explanation):
{
  "chat": "your response message to say in game chat, or null",
  "skillName": "exact name of a LEARNED SKILL to execute (from the list above), or null",
  "skillParams": { "count": 5, "blockName": "oak_log" } or null -- runtime parameters to pass to the skill,
  "action": "NEW JavaScript code (async function action(bot, mcData, pathfinderGoals, params={}){...}) ONLY if no learned skill fits, or null",
  "taskName": "short snake_case name WITHOUT numbers (e.g. 'mine_block', 'craft_planks') to save the new skill under, or null",
  "done": true or false
}

RULES (strictly follow these):
- "skillName" and "action" are MUTUALLY EXCLUSIVE. Never set both.
- ALWAYS prefer a learned skill over writing new code. If a skill matches, set "skillName" to its exact name and leave "action" null.
- Only write new "action" code when NO learned skill can accomplish the step.
- When writing new code, always provide a "taskName" so the system can save it.
- For chat-only responses (questions, conversation), set both "skillName" and "action" to null.
- For multi-step tasks, return only the FIRST step and set "done": false. The system will call you again with the updated game state.
- Keep chat short (256 char Minecraft limit).
- Be helpful and friendly. Respond in the same language as the player.`;
}

/**
 * Builds a test-mode prompt: the bot can ONLY use skills it has already
 * learned (saved in the skills library). No improvisation allowed.
 * If the request cannot be fulfilled with existing skills, the bot
 * must honestly say it has not learned that yet.
 *
 */
function testChatPrompt(gameState, playerName, playerMessage, learnedSkills, conversationHistory = []) {
  const historySection = conversationHistory.length > 0
    ? `\nRECENT CONVERSATION:\n${conversationHistory.join("\n")}\n`
    : "";

  const skillsSection = learnedSkills.length > 0
    ? learnedSkills.map(s => `--- SKILL: ${s.name} ---\n${s.code}`).join("\n\n")
    : "(no skills learned yet)";

  return `You are a Minecraft bot named Voyager G running in TEST MODE.
A player is evaluating what you have learned so far.

CRITICAL RULES FOR TEST MODE:
- You may ONLY execute actions using the LEARNED SKILLS listed below.
- You MUST NOT generate new code, improvise, or try creative workarounds.
- If a player asks you to do something and NONE of your learned skills can accomplish it, you MUST reply honestly: "I haven't learned how to do that yet."
- You may COMBINE multiple learned skills in sequence if the task requires it (e.g., mine logs THEN craft planks).
- Use "skillParams" to pass runtime values (count, blockName, etc.) to the skill -- never rewrite the skill code just to change a number.

${systemPrompt()}

CURRENT GAME STATE:
${gameState}
${historySection}
LEARNED SKILLS (this is everything you know how to do):
${skillsSection}

PLAYER "${playerName}" SAYS: "${playerMessage}"

You MUST respond with a valid JSON object and NOTHING ELSE:
{
  "chat": "your response to the player, or null",
  "action": "JavaScript code using the learned skill's logic, or null if you cannot do it",
  "skillUsed": "name of the skill(s) you are using, or null",
  "skillParams": { "count": 5, "blockName": "oak_log" } or null,
  "done": true or false
}

Remember: if you do not have a matching skill, set action to null and explain in chat that you have not learned this yet.`;
}

module.exports = {
  systemPrompt,
  skillSelectPrompt,
  actionPrompt,
  correctionPrompt,
  curriculumPrompt,
  playerChatPrompt,
  testChatPrompt,
};
