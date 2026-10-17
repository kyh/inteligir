// a named action's prompt block, composed on the server like the view context's: the stored text
// stays what the person typed (or the preset's label), and the block is its own `text` element
// ahead of the context, never a prefix on their words.

import type { ActionPreset } from "@repo/domain/action-preset";

// what a session can rely on when a block names its tools: the CLI on the agent's PATH, and the
// library's own filing rules (its AGENTS.md) among the instructions
export interface PromptFacts {
  cli: boolean;
  filingRules: boolean;
}

// PIVOT-STUB(S3): replaced by Tidy my library's procedure, worded for the facts it is given
// (§12.4 point 4)
export const composePresetBlock = (_preset: ActionPreset, _facts: PromptFacts): string => "";
