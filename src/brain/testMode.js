/**
 * Test mode.
 * Chat mode restricted to already learned skills.
 */

const { chat } = require("./gemini");
const { testChatPrompt } = require("./prompts");
const { executeCode } = require("./actionAgent");
const { observe } = require("../observer");
const { listSkills, loadSkill } = require("../skills/library");
const logger = require("../utils/logger");
const { truncate } = require("../utils/helpers");

const MAX_HISTORY = 20;
const conversationHistory = [];
const MAX_FOLLOW_UPS = 10;

/** Loads all learned skills with source code. */
function loadAllSkills() {
  const names = listSkills();
  return names.map((name) => {
    const code = loadSkill(name);
    return { name, code: code || "(could not load)" };
  });
}

/** Parses model JSON output for test mode. */
function parseResponse(raw) {
  let cleaned = raw.trim();
  const jsonMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (jsonMatch) {
    cleaned = jsonMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(cleaned);
    return {
      chat: typeof parsed.chat === "string" ? parsed.chat : null,
      action: typeof parsed.action === "string" ? parsed.action : null,
      skillUsed: typeof parsed.skillUsed === "string" ? parsed.skillUsed : null,
      skillParams: parsed.skillParams && typeof parsed.skillParams === "object" ? parsed.skillParams : {},
      done: parsed.done !== false,
    };
  } catch (err) {
    logger.warn("TestMode", `Failed to parse JSON: ${err.message}`);
    return { chat: cleaned, action: null, skillUsed: null, done: true };
  }
}

/** Adds one line to short-term history. */
function pushHistory(line) {
  conversationHistory.push(line);
  if (conversationHistory.length > MAX_HISTORY) {
    conversationHistory.shift();
  }
}

/** Sends chat text and splits long messages. */
function safeChat(bot, text) {
  const chunks = text.match(/.{1,250}/g) || [];
  for (const chunk of chunks) {
    bot.chat(chunk);
  }
}

/**
 * Handles a player message in test mode.
 * Similar to player mode but with the learned-skills-only constraint.
 *
 */
async function handleTestMessage(bot, mcData, playerName, message) {
  logger.info("TestMode", `Processing message from ${playerName}: "${message}"`);
  pushHistory(`<${playerName}> ${message}`);

  const originalRequest = message;
  let step = 0;
  let isDone = false;

  // Load the skill library once per request
  const learnedSkills = loadAllSkills();
  logger.info("TestMode", `${learnedSkills.length} learned skills available`);

  while (!isDone && step < MAX_FOLLOW_UPS) {
    step++;

    try {
      const gameState = observe(bot);

      const promptMessage = step === 1
        ? originalRequest
        : `[CONTINUE] The player originally asked: "${originalRequest}". ` +
          `You completed step ${step - 1}. Check the updated game state and perform the next step using ONLY learned skills.`;

      const prompt = testChatPrompt(gameState, playerName, promptMessage, learnedSkills, conversationHistory);
      const rawResponse = await chat(prompt);

      logger.debug("TestMode", `Raw LLM response (step ${step}): ${truncate(rawResponse, 300)}`);

      const { chat: chatReply, action: actionCode, skillUsed, skillParams, done } = parseResponse(rawResponse);
      isDone = done;

      if (skillUsed) {
        logger.info("TestMode", `Using learned skill: ${skillUsed}${Object.keys(skillParams).length ? ` with params: ${JSON.stringify(skillParams)}` : ""}`);
      }

      if (chatReply) {
        safeChat(bot, chatReply);
        pushHistory(`<${bot.username}> ${chatReply}`);
        logger.info("TestMode", `Chat reply (step ${step}): "${truncate(chatReply, 200)}"`);
      }

      if (actionCode) {
        logger.info("TestMode", `Executing skill step ${step}...`);
        try {
          const result = await executeCode(actionCode, bot, mcData, skillParams);
          logger.info("TestMode", `Skill step ${step} completed: ${result}`);
          pushHistory(`[system] Skill step ${step} result: ${truncate(String(result), 150)}`);
        } catch (err) {
          logger.warn("TestMode", `Skill step ${step} failed: ${err.message}`);
          safeChat(bot, `Step ${step} failed: ${truncate(err.message, 200)}`);
          pushHistory(`[system] Skill step ${step} error: ${truncate(err.message, 150)}`);
          isDone = true;
        }
      } else if (!chatReply) {
        isDone = true;
      }
    } catch (err) {
      logger.error("TestMode", `Error at step ${step}: ${err.message}`);
      safeChat(bot, "Sorry, I encountered an error. Please try again.");
      isDone = true;
    }
  }

  if (step >= MAX_FOLLOW_UPS && !isDone) {
    logger.warn("TestMode", `Reached max follow-up steps (${MAX_FOLLOW_UPS})`);
    safeChat(bot, "I've reached my step limit for this request.");
  }
}

/**
 * Starts the test mode: registers chat listener and announces itself.
 *
 */
function startTestMode(bot, mcData) {
  const skills = listSkills();
  logger.info("TestMode", `Test mode active. ${skills.length} learned skills loaded.`);
  bot.chat(`Test mode active! I know ${skills.length} skills. Ask me what I can do!`);

  let processing = false;

  bot.on("chat", async (username, message) => {
    if (username === bot.username) return;

    if (processing) {
      logger.debug("TestMode", `Skipping message from ${username} (already processing)`);
      return;
    }

    processing = true;
    try {
      await handleTestMessage(bot, mcData, username, message);
    } finally {
      processing = false;
    }
  });
}

module.exports = { startTestMode, handleTestMessage };
