// The instructions appended to each provider session (start/resume): a short
// built-in pointer at the CLI, then the vault's own AGENTS.md — the user's
// standing instructions — when present. Loaded at session construction, so an
// edit applies from the next session rather than mid-turn. Head-capped —
// instruction bytes are a recurring per-turn prompt cost, which is also why
// the CLI pointer is three sentences and the manual lives behind
// `inteligir guide` instead of in the prompt.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { errnoCode } from "../errno";

const AGENT_INSTRUCTIONS_FILE = "AGENTS.md";
const AGENT_INSTRUCTIONS_MAX_BYTES = 32_768;

/** Kept minimal on purpose: the full manual is a `inteligir guide` away, so
 *  the per-turn cost is a pointer, not the manual. */
export const CLI_POINTER_INSTRUCTIONS = `The \`inteligir\` CLI drives this notes app from your shell: vault file CRUD, \
full-text search, agent threads. INTELIGIR_SERVER_URL and INTELIGIR_THREAD_ID \
are set in your environment. Run \`inteligir guide\` for the manual; every \
command takes \`--json\`.`;

function loadVaultInstructions(vaultDir: string): string | undefined {
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

export function loadAgentInstructions(vaultDir: string): string {
  const vaultInstructions = loadVaultInstructions(vaultDir);
  return vaultInstructions === undefined
    ? CLI_POINTER_INSTRUCTIONS
    : `${CLI_POINTER_INSTRUCTIONS}\n\n${vaultInstructions}`;
}
