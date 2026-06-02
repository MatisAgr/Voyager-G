/**
 * Critic agent.
 * Juge si une tache a vraiment ete accomplie, a partir du delta d'inventaire
 * calcule en code (fiable) et de l'etat apres action. Ne sert qu'au curriculum :
 * il ne bloque jamais la sauvegarde d'un skill.
 */

const { chat } = require("./gemini");
const logger = require("../utils/logger");

/** Formate le delta d'inventaire calcule en code (source fiable, pas d'hallucination). */
function formatInventoryDelta(before = {}, after = {}) {
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);
  const lines = [];
  for (const n of [...names].sort()) {
    const d = (after[n] || 0) - (before[n] || 0);
    if (d > 0) lines.push(`  +${d} ${n}`);
    else if (d < 0) lines.push(`  ${d} ${n}`);
  }
  return lines.length ? lines.join("\n") : "  (aucun changement d'inventaire)";
}

/** Verifie si une tache a vraiment ete accomplie. */
async function verifyCritic(task, stateBefore, stateAfter, codeResult, invBefore = {}, invAfter = {}) {
  const inventoryDelta = formatInventoryDelta(invBefore, invAfter);

  const prompt = `You are a Minecraft task verification expert.
Decide whether the TASK below was TRULY accomplished.

TASK: "${task}"
CODE RETURN VALUE (may lie): "${codeResult}"

=== INVENTORY CHANGES (computed in code, EXACT -- trust this) ===
${inventoryDelta}

=== GAME STATE AFTER ===
${stateAfter}

VERIFICATION RULES:
- Base your verdict on the INVENTORY CHANGES above. It is computed exactly; do
  NOT re-derive deltas from the text yourself.
- "Mine N X" or "Get N X": the agent must have GAINED the expected item.
  Ores drop raw items (iron_ore -> raw_iron, etc.); logs give the log item.
- "Craft X": there must be a "+N X" line. Consumed ingredients or a used-up
  crafting_table are NORMAL and do NOT mean failure.
- "Kill X": look for gained mob drops (bones, rotten_flesh, leather, beef...).
- Movement/exploration tasks ("explore", "navigate", "go to", "walk") legitimately
  produce NO inventory change -- treat them as SUCCESS if no error occurred.
- A wrong variant counts as failure (e.g. task asked oak_log but agent got acacia_log).

Respond with EXACTLY this JSON (no markdown, no extra text):
{
  "success": true/false,
  "reasoning": "one short sentence on what actually changed",
  "critique": "if failed: one concrete next step to fix it; if success: empty string"
}`;

  try {
    const raw = await chat(prompt, { temperature: 0.1, role: "curriculum" });

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
    // En cas d'echec du critic, on fait confiance au code (fail-open).
    return { success: true, reasoning: "Critic unavailable, trusting code result.", critique: "" };
  }
}

module.exports = { verifyCritic };
