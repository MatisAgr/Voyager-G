/**
 * Curriculum module.
 * Asks the model for the next task based on current state and history.
 */

const { chat } = require("../brain/gemini");
const { curriculumPrompt } = require("../brain/prompts");
const logger = require("../utils/logger");

/** Asks the model for the next task. */
async function proposeNextTask(gameState, completedTasks = [], failedTasks = [], critique = "") {
  logger.info("Curriculum", "Asking LLM for the next task...");

  const prompt = curriculumPrompt(gameState, completedTasks, failedTasks, critique);
  const task = await chat(prompt, {
    temperature: 0.9,
    model: process.env.GCP_MODEL_CURRICULUM || "gemini-2.0-flash-lite",
    role: "curriculum",
  });

  // Keep only the first line.
  const cleaned = task.trim().split("\n")[0].trim();

  logger.info("Curriculum", `Proposed task: "${cleaned}"`);
  return cleaned;
}

module.exports = { proposeNextTask };
