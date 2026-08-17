// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.
// Trimmed to the level→effort expansion the codex model-list parser needs;
// the per-level exported constants collapse into the private table.

import type { ModelReasoningEffort } from "./provider-types";
import type { ReasoningLevel } from "./shared-types";

const REASONING_EFFORT_BY_LEVEL: Record<ReasoningLevel, ModelReasoningEffort> = {
  none: { reasoningEffort: "none", description: "No extended thinking" },
  low: { reasoningEffort: "low", description: "Low reasoning effort" },
  medium: { reasoningEffort: "medium", description: "Medium reasoning effort" },
  high: { reasoningEffort: "high", description: "High reasoning effort" },
  xhigh: { reasoningEffort: "xhigh", description: "Extra high reasoning effort" },
  ultracode: {
    reasoningEffort: "ultracode",
    description: "Extra high reasoning effort plus multi-agent workflow orchestration",
  },
  max: { reasoningEffort: "max", description: "Maximum reasoning effort" },
  ultra: {
    reasoningEffort: "ultra",
    description: "Maximum reasoning with automatic task delegation",
  },
};

// Expands coarse reasoning levels into the descriptive picker entries above.
// Returns fresh objects so callers can hand the result out in mutable API
// responses without aliasing the module-level constants.
export function reasoningEffortsForLevels(
  levels: readonly ReasoningLevel[],
): ModelReasoningEffort[] {
  return levels.map((level) => ({ ...REASONING_EFFORT_BY_LEVEL[level] }));
}
