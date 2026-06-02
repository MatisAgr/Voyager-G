/**
 * Action agent.
 * Selects a skill or generates code, executes it, and retries on failure.
 */

const { chat } = require("./gemini");
const { skillSelectPrompt, actionPrompt, correctionPrompt } = require("./prompts");
const { loadSkill, saveSkill } = require("../skills/library");
const { retrieveRelevantSkills } = require("../skills/retrieval");
const { goals: pathfinderGoals } = require("mineflayer-pathfinder");
const logger = require("../utils/logger");
const { sleep } = require("../utils/helpers");

const ACTION_MAX_RETRIES      = parseInt(process.env.ACTION_MAX_RETRIES,        10) || 3;
const ACTION_RETRY_DELAY      = parseInt(process.env.ACTION_RETRY_DELAY_MS,    10) || 2000;
const ACTION_TIMEOUT_MS       = parseInt(process.env.ACTION_TIMEOUT_MS,         10) || 90000;
// Token budget for generated code.
const CODE_MAX_OUTPUT_TOKENS  = parseInt(process.env.CODE_MAX_OUTPUT_TOKENS,    10) || 8192;

// Number of times a learned skill was reused.
let usedLearnedTaskCount = 0;

/**
 * Extracts JavaScript code from the LLM's response.
 * Handles responses wrapped in ```javascript ... ``` blocks.
 */
function extractCode(response) {
  // Try to extract from fenced code block
  const fencedMatch = response.match(/```(?:javascript|js)?\s*\n?([\s\S]*?)```/);
  if (fencedMatch) {
    return fencedMatch[1].trim();
  }
  // Fallback: treat entire response as code
  return response.trim();
}

/** Executes generated code in the bot context. */
async function executeCode(code, bot, mcData, params = {}) {
  // Build and run action(bot, mcData, pathfinderGoals, params).
  const wrappedCode = `
    ${code}
    return action(bot, mcData, pathfinderGoals, params);
  `;

  const fn = new Function("bot", "mcData", "require", "pathfinderGoals", "params", wrappedCode);

  // Timeout is reset while the bot is moving.
  let watchdogTimer;
  let lastPos = bot.entity?.position?.clone();
  let cleanupWatchdog = null;

  const timeoutPromise = new Promise((_, reject) => {
    const resetWatchdog = () => {
      clearTimeout(watchdogTimer);
      watchdogTimer = setTimeout(() => {
        cleanupWatchdog?.();
        reject(new Error(`Action timed out after ${ACTION_TIMEOUT_MS / 1000}s of inactivity. Possible infinite loop.`));
      }, ACTION_TIMEOUT_MS);
    };

    // Reset watchdog on movement.
    const interval = setInterval(() => {
      const pos = bot.entity?.position;
      if (pos && lastPos && pos.distanceTo(lastPos) > 0.5) {
        lastPos = pos.clone();
        resetWatchdog();
      }
      lastPos = pos?.clone() || lastPos;
    }, 2000);

    cleanupWatchdog = () => {
      clearInterval(interval);
      clearTimeout(watchdogTimer);
    };

    resetWatchdog();
  });

  try {
    // Consume the losing promise rejection in Promise.race.
    const execPromise    = fn(bot, mcData, require, pathfinderGoals, params);
    timeoutPromise.catch(() => {});
    execPromise.catch(() => {});

    const result = await Promise.race([execPromise, timeoutPromise]);
    return result;
  } finally {
    cleanupWatchdog?.();
  }
}

/** Runs one task cycle: select skill/code, execute, retry if needed. */
async function executeTask(bot, mcData, gameState, task, availableSkills = []) {
  const maxRetries = ACTION_MAX_RETRIES;

  //  Phase 1: Ask Gemini which skill to use, or get new code
  logger.info("ActionAgent", `Phase 1 - selecting skill for task: "${task}"`);
  // Ne montrer que les skills les plus pertinents pour garder le prompt court.
  const relevantSkills = retrieveRelevantSkills(task, availableSkills);
  const selectionPrompt = skillSelectPrompt(gameState, task, relevantSkills);
  let selectionRaw;
  try {
    selectionRaw = await chat(selectionPrompt);
  } catch (err) {
    logger.error("ActionAgent", `Phase 1 LLM call failed: ${err.message}`);
    return { success: false, result: err.message, code: "", saved: false };
  }

  // Parse the JSON decision from Gemini
  let decision;
  try {
    const jsonMatch = selectionRaw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON object found in response.");
    decision = JSON.parse(jsonMatch[0]);
  } catch (err) {
    logger.error("ActionAgent", `Phase 1 JSON parse failed: ${err.message}\nRaw: ${selectionRaw}`);
    return { success: false, result: `Phase 1 parse error: ${err.message}`, code: "", saved: false };
  }

  const { skillName, skillParams = {}, action: actionSignal, taskName } = decision;

  //  Phase 2a: Reuse a known skill 
  if (skillName) {
    logger.info("ActionAgent", `Reusing skill "${skillName}" with params: ${JSON.stringify(skillParams)}`);
    const skillSource = loadSkill(skillName);
    if (!skillSource) {
      logger.warn("ActionAgent", `Skill "${skillName}" not found on disk, falling back to new code path.`);
    } else {
      let lastCode = skillSource;
      let lastError = "";

      for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
        try {
          const code = attempt === 1 ? skillSource : extractCode(await chat(
            correctionPrompt(gameState, task, lastCode, lastError, attempt, maxRetries + 1),
            { maxOutputTokens: CODE_MAX_OUTPUT_TOKENS, role: "codegen" }
          ));
          lastCode = code;
          const result = await executeCode(code, bot, mcData, skillParams);
          logger.info("ActionAgent", `Task "${task}" succeeded via skill "${skillName}": ${result}`);
          usedLearnedTaskCount++;
          return { success: true, result, code, saved: false };
        } catch (err) {
          lastError = err.message || String(err);
          logger.warn("ActionAgent", `Skill "${skillName}" attempt ${attempt} failed: ${lastError}`);
          if (attempt <= maxRetries) await sleep(ACTION_RETRY_DELAY);
        }
      }

      logger.error("ActionAgent", `Skill "${skillName}" failed after ${maxRetries + 1} attempts.`);
      return { success: false, result: lastError, code: lastCode, saved: false };
    }
  }

  //  Phase 2b: Generate and execute new code 
  if (actionSignal !== "new") {
    const msg = "Phase 1 returned neither skillName nor 'new' action signal.";
    logger.error("ActionAgent", msg);
    return { success: false, result: msg, code: "", saved: false };
  }

  logger.info("ActionAgent", `Phase 2 - generating new code for task: "${task}"`);

  // Separate LLM call: code is returned as plain text, no JSON wrapping.
  // This avoids the truncation issue that arises when embedding multi-line
  // code as a JSON string value in Phase 1.
  let initialCode;
  try {
    const codeRaw = await chat(actionPrompt(gameState, task, availableSkills), { maxOutputTokens: CODE_MAX_OUTPUT_TOKENS, role: "codegen" });
    initialCode = extractCode(codeRaw);
  } catch (err) {
    logger.error("ActionAgent", `Phase 2 code generation failed: ${err.message}`);
    return { success: false, result: err.message, code: "", saved: false };
  }

  let lastCode = initialCode;
  let lastError = "";

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      const code = attempt === 1 ? initialCode : extractCode(await chat(
        correctionPrompt(gameState, task, lastCode, lastError, attempt, maxRetries + 1),
        { maxOutputTokens: CODE_MAX_OUTPUT_TOKENS, role: "codegen" }
      ));
      lastCode = code;

      logger.info("ActionAgent", `Attempt ${attempt}/${maxRetries + 1} code:\n${code}`);
      const result = await executeCode(code, bot, mcData, {});
      logger.info("ActionAgent", `Task "${task}" succeeded with new code: ${result}`);

      // Sauvegarder des que le code reussit (le critic ne sert qu'au curriculum).
      let saved = false;
      if (taskName) {
        saveSkill(taskName, code, result);
        logger.info("ActionAgent", `New skill saved: "${taskName}"`);
        saved = true;
      }

      return { success: true, result, code, saved, taskName };
    } catch (err) {
      lastError = err.message || String(err);
      logger.warn("ActionAgent", `New code attempt ${attempt} failed: ${lastError}\nCode:\n${lastCode}`);
      if (attempt <= maxRetries) await sleep(ACTION_RETRY_DELAY);
    }
  }

  logger.error("ActionAgent", `Task "${task}" failed after ${maxRetries + 1} attempts.`);
  return { success: false, result: lastError, code: lastCode, saved: false };
}

module.exports = { executeTask, extractCode, executeCode, getUsedLearnedTaskCount: () => usedLearnedTaskCount };
