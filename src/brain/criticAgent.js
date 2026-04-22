/**
 * Critic agent.
 * Verifies task success from before/after state and returns a verdict.
 */

const { chat } = require("./gemini");
const logger = require("../utils/logger");

/** Verifies if a task was truly completed. */
async function verifyCritic(task, stateBefore, stateAfter, codeResult) {
  const prompt = `You are a Minecraft task verification expert.
Your job is to determine whether a task was TRULY completed by comparing
the game state BEFORE and AFTER execution.

TASK: "${task}"
CODE RETURN VALUE: "${codeResult}"

=== GAME STATE BEFORE ===
${stateBefore}

=== GAME STATE AFTER ===
${stateAfter}

VERIFICATION RULES:
- Compare inventories carefully. If the task was "Mine 3 iron_ore", the agent
  must have gained at least 3 raw_iron (not iron_ore -- ores drop raw items).
- If the task was "Craft X", the item must appear in the AFTER inventory.
- If the task was "Kill X", check for mob drops (rotten_flesh, bones, etc.)
  or reduced nearby entity count.
- If health dropped significantly (>5 hearts) but the task is NOT combat-related,
  the agent may have been attacked and distracted. Mark as failure.
- Check food level: if food dropped to 0, the agent may be starving and unable
  to sprint or heal, which blocks further progress.
- Be strict: the code's return value can lie. Only trust inventory/state changes.

Respond with EXACTLY this JSON (no markdown, no extra text):
{
  "success": true/false,
  "reasoning": "Brief explanation of what changed in the state",
  "critique": "If failed: one concrete next step to fix the problem. If succeeded: empty string."
}`;

  try {
    const raw = await chat(prompt, {
      temperature: 0.1,
      role: "curriculum",
    });

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn("Critic", `No JSON found in critic response: ${raw}`);
      return { success: true, reasoning: "Critic response unparseable, assuming success.", critique: "" };
    }

    const verdict = JSON.parse(jsonMatch[0]);
    logger.info(
      "Critic",
      `Task "${task}" => ${verdict.success ? "VERIFIED" : "REJECTED"} | ${verdict.reasoning}`
    );

    if (!verdict.success && verdict.critique) {
      logger.info("Critic", `Critique: ${verdict.critique}`);
    }

    return {
      success:   !!verdict.success,
      reasoning: verdict.reasoning || "",
      critique:  verdict.critique  || "",
    };
  } catch (err) {
    logger.error("Critic", `Critic LLM call failed: ${err.message}`);
    // On critic failure, trust the code's result (fail-open)
    return { success: true, reasoning: "Critic unavailable, trusting code result.", critique: "" };
  }
}

module.exports = { verifyCritic };
