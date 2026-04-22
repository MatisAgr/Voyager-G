/**
 * Gemini client wrapper (Vertex AI).
 * Centralizes all model calls and counters.
 */

const { GoogleGenAI } = require("@google/genai");
const logger = require("../utils/logger");

const GCP_PROJECT        = process.env.GCP_PROJECT        || "memoire-agent-minecraft";
const GCP_LOCATION       = process.env.GCP_LOCATION       || "us-central1";
const GCP_MODEL          = process.env.GCP_MODEL          || "gemini-2.0-flash-lite";
const GCP_TEMPERATURE    = parseFloat(process.env.GCP_TEMPERATURE)    || 0.7;
const GCP_MAX_OUTPUT_TOKENS = parseInt(process.env.GCP_MAX_OUTPUT_TOKENS, 10) || 4096;

// Lazy singleton client.
let client = null;

// Prompt counters for dashboard metrics.
let agentPromptCount = 0;
let curriculumPromptCount = 0;
// Counts only code generation calls.
let codeGenPromptCount = 0;

/** Returns the Vertex AI client. */
function getClient() {
  if (!client) {
    client = new GoogleGenAI({
      vertexai: true,
      project: GCP_PROJECT,
      location: GCP_LOCATION,
    });
    logger.info(
      "Gemini",
      `Vertex AI client initialised (project: ${GCP_PROJECT}, location: ${GCP_LOCATION}, model: ${GCP_MODEL})`
    );
  }
  return client;
}

/** Sends a prompt and returns the model text response. */
async function chat(prompt, options = {}) {
  const ai = getClient();

  const model          = options.model          || GCP_MODEL;
  const temperature    = options.temperature    ?? GCP_TEMPERATURE;
  const maxOutputTokens = options.maxOutputTokens ?? GCP_MAX_OUTPUT_TOKENS;

  logger.debug("Gemini", `Sending prompt (${prompt.length} chars) to ${model}`);

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        temperature,
        maxOutputTokens,
      },
    });

    const text = response.text;
    if (options.role === "curriculum") {
      curriculumPromptCount += 1;
    } else {
      agentPromptCount += 1;
      if (options.role === "codegen") codeGenPromptCount += 1;
    }
    logger.info(
      "Gemini",
      `Response received (${text.length} chars) | agent: ${agentPromptCount} | curriculum: ${curriculumPromptCount}`
    );
    return text;
  } catch (err) {
    logger.error("Gemini", `API call failed: ${err.message}`);
    throw err;
  }
}

module.exports = {
  chat,
  getAgentPromptCount:      () => agentPromptCount,
  getCurriculumPromptCount: () => curriculumPromptCount,
  getCodeGenPromptCount:    () => codeGenPromptCount,
  getPromptCount:           () => agentPromptCount + curriculumPromptCount,
};
