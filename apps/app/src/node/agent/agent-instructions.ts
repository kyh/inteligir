// The vault's own AGENTS.md is the user's standing instructions: loaded at
// each provider-session construction (start/resume), so an edit applies from
// the next session rather than mid-turn. Head-capped — instruction bytes are
// a recurring per-turn prompt cost.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { errnoCode } from "../errno";

const AGENT_INSTRUCTIONS_FILE = "AGENTS.md";
const AGENT_INSTRUCTIONS_MAX_BYTES = 32_768;

export function loadAgentInstructions(vaultDir: string): string | undefined {
  let raw: string;
  try {
    raw = readFileSync(join(vaultDir, AGENT_INSTRUCTIONS_FILE), "utf8");
  } catch (error) {
    if (errnoCode(error) === "ENOENT" || errnoCode(error) === "EISDIR") {
      return undefined;
    }
    throw error;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  return trimmed.length > AGENT_INSTRUCTIONS_MAX_BYTES
    ? trimmed.slice(0, AGENT_INSTRUCTIONS_MAX_BYTES)
    : trimmed;
}
