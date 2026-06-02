/**
 * Player mode.
 * Handles player chat requests with optional follow-up action loops.
 */

const { chat } = require("./gemini");
const logger = require("../utils/logger");
const { playerChatPrompt } = require("./prompts");
const { executeCode, extractCode } = require("./actionAgent");
const { observe } = require("../observer");
const { listSkills, loadSkill, saveSkill } = require("../skills/library");
const { retrieveRelevantSkills } = require("../skills/retrieval");
const { truncate } = require("../utils/helpers");

// Rolling short-term history.
const MAX_HISTORY = 20;
const conversationHistory = [];

// Max chained follow-ups.
const MAX_FOLLOW_UPS = 10;

/** Parses model JSON output with safe fallbacks. */
function parseResponse(raw) {
  let cleaned = raw.trim();

  // Remove optional markdown fences.
  const jsonMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (jsonMatch) {
    cleaned = jsonMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(cleaned);
    return {
      chat: typeof parsed.chat === "string" ? parsed.chat : null,
      skillName: typeof parsed.skillName === "string" ? parsed.skillName : null,
      skillParams: parsed.skillParams && typeof parsed.skillParams === "object" ? parsed.skillParams : {},
      action: typeof parsed.action === "string" ? parsed.action : null,
      taskName: typeof parsed.taskName === "string" ? parsed.taskName : null,
      done: parsed.done !== false,
    };
  } catch (err) {
    logger.warn("PlayerMode", `Failed to parse JSON from LLM, treating as plain chat: ${err.message}`);
    return { chat: cleaned, skillName: null, action: null, taskName: null, done: true };
  }
}

/**
 * Pushes a line into the rolling conversation history.
 */
function pushHistory(line) {
  conversationHistory.push(line);
  if (conversationHistory.length > MAX_HISTORY) {
    conversationHistory.shift();
  }
}

/**
 * Sends a chat message in-game, splitting long messages to fit the
 * Minecraft 256-character limit.
 */
function safeChat(bot, text) {
  const chunks = text.match(/.{1,250}/g) || [];
  for (const chunk of chunks) {
    bot.chat(chunk);
  }
}

/**
 * Handles a single chat message from a player.
 * Gathers context, queries Gemini, dispatches chat/action, and
 * follows up with more steps if Gemini says the task is not done.
 *
 */
async function handlePlayerMessage(bot, mcData, playerName, message) {
  logger.info("PlayerMode", `Processing message from ${playerName}: "${message}"`);
  pushHistory(`<${playerName}> ${message}`);

  // The original player request is kept constant through the follow-up loop
  // so Gemini always knows what the end-goal is.
  const originalRequest = message;
  let step = 0;
  let isDone = false;

  while (!isDone && step < MAX_FOLLOW_UPS) {
    step++;

    try {
      // Re-observe the game state before each step (inventory/position may have changed)
      const gameState = observe(bot);

      // Ne charger que les skills pertinents (prompt plus court).
      const skillNames = retrieveRelevantSkills(originalRequest, listSkills());

      // Build the prompt. On follow-up steps, prepend "Continue the task"
      // so Gemini knows this is a continuation, not a new request.
      const promptMessage = step === 1
        ? originalRequest
        : `[CONTINUE] The player originally asked: "${originalRequest}". ` +
          `You already completed step ${step - 1}. Check the updated game state and perform the next step.`;

      const prompt = playerChatPrompt(gameState, playerName, promptMessage, conversationHistory, skillNames);
      const rawResponse = await chat(prompt);

      logger.debug("PlayerMode", `Raw LLM response (step ${step}): ${truncate(rawResponse, 300)}`);

      const { chat: chatReply, skillName, skillParams, action: actionCode, done, taskName } = parseResponse(rawResponse);
      isDone = done;

      // Send chat reply if any
      if (chatReply) {
        safeChat(bot, chatReply);
        pushHistory(`<${bot.username}> ${chatReply}`);
        logger.info("PlayerMode", `Chat reply (step ${step}): "${truncate(chatReply, 200)}"`);
      }

      // Determine which code to execute:
      // - If Gemini picked a known skill -> load code from disk (no rewrite)
      // - If Gemini wrote new code -> use it directly and save if successful
      let codeToRun = null;
      let isNewSkill = false;

      if (skillName) {
        const raw = loadSkill(skillName);
        if (raw) {
          // Extract only the function body (strip the file header comment block)
          codeToRun = extractCode(raw);
          logger.info("PlayerMode", `Reusing learned skill "${skillName}" from disk${Object.keys(skillParams).length ? ` with params: ${JSON.stringify(skillParams)}` : ""}`);
        } else {
          logger.warn("PlayerMode", `Skill "${skillName}" not found on disk, skipping action`);
          safeChat(bot, `I tried to use skill "${skillName}" but couldn't find it.`);
          isDone = true;
        }
      } else if (actionCode) {
        codeToRun = actionCode;
        isNewSkill = true;
        logger.info("PlayerMode", `Executing new code for step ${step}...`);
      }

      if (codeToRun) {
        try {
          // Pass skillParams for known skills, or empty object for new code
          const result = await executeCode(codeToRun, bot, mcData, isNewSkill ? {} : skillParams);
          logger.info("PlayerMode", `Step ${step} completed: ${result}`);
          pushHistory(`[system] Step ${step} result: ${truncate(String(result), 150)}`);

          // Learning: save only brand-new code that was not already a known skill
          if (isNewSkill && taskName) {
            const existingSkills = listSkills();
            const safeName = taskName.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
            if (!existingSkills.includes(safeName)) {
              saveSkill(taskName, codeToRun, String(result));
              logger.info("PlayerMode", `New skill learned: "${taskName}"`);
              safeChat(bot, `I learned a new skill: ${taskName}`);
            }
          }
        } catch (err) {
          logger.warn("PlayerMode", `Step ${step} failed: ${err.message}`);
          safeChat(bot, `Step ${step} failed: ${truncate(err.message, 200)}`);
          pushHistory(`[system] Step ${step} error: ${truncate(err.message, 150)}`);
          isDone = true;
        }
      } else if (!chatReply) {
        // No chat, no action -- nothing to do, break
        isDone = true;
      }
    } catch (err) {
      logger.error("PlayerMode", `Error at step ${step}: ${err.message}`);
      safeChat(bot, "Sorry, I encountered an error. Please try again.");
      isDone = true;
    }
  }

  if (step >= MAX_FOLLOW_UPS && !isDone) {
    logger.warn("PlayerMode", `Reached max follow-up steps (${MAX_FOLLOW_UPS}) for request: "${originalRequest}"`);
    safeChat(bot, "I've reached my step limit for this request. Please ask again if you need more.");
  }
}

/**
 * Starts the player mode: registers chat listener and idles.
 *
 */
function startPlayerMode(bot, mcData) {
  logger.info("PlayerMode", "Player mode active. Listening for chat commands...");
  bot.chat("Player mode active. Talk to me!");

  // Track whether we are currently processing a message to avoid overlap
  let processing = false;

  bot.on("chat", async (username, message) => {
    // Ignore the bot's own messages
    if (username === bot.username) return;

    // Skip if already processing a message (prevents overlapping LLM calls)
    if (processing) {
      logger.debug("PlayerMode", `Skipping message from ${username} (already processing)`);
      return;
    }

    processing = true;
    try {
      await handlePlayerMessage(bot, mcData, username, message);
    } finally {
      processing = false;
    }
  });
}

module.exports = { startPlayerMode, handlePlayerMessage };
