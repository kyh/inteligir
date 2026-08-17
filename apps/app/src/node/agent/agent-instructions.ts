// The instructions appended to each provider session (start/resume): a short
// built-in pointer at the CLI — only when the CLI is actually reachable from
// the agent's PATH — then the vault's own AGENTS.md, the user's standing
// instructions. Loaded at session construction, so an edit applies from the
// next session rather than mid-turn. Head-capped: instruction bytes are a
// recurring per-turn prompt cost, which is also why the CLI pointer is three
// sentences and the manual lives behind `inteligir guide` instead.

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

/**
 * Cut to at most `maxBytes` of UTF-8 WITHOUT splitting a character. Measuring
 * `string.length` would count UTF-16 units (wrong for any non-BMP text) and
 * slicing by it can halve a surrogate pair, which reaches the model as U+FFFD.
 */
function headCapUtf8(text: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= maxBytes) {
    return text;
  }
  // fatal:false lets the decoder drop a trailing partial sequence rather than
  // throw; the cut is then on a real code-point boundary.
  const decoded = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes.subarray(0, maxBytes));
  return decoded.endsWith("�") ? decoded.slice(0, -1) : decoded;
}

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
  return headCapUtf8(trimmed, AGENT_INSTRUCTIONS_MAX_BYTES);
}

/**
 * `cliBinDir` is the resolved CLI location (null when this deployment ships
 * none): the pointer is a PROMISE about the agent's shell, so it is stated
 * only when the binary is really on the PATH the shell env builds.
 */
export function loadAgentInstructions(
  vaultDir: string,
  cliBinDir: string | null,
): string | undefined {
  const vaultInstructions = loadVaultInstructions(vaultDir);
  if (cliBinDir === null) {
    return vaultInstructions;
  }
  return vaultInstructions === undefined
    ? CLI_POINTER_INSTRUCTIONS
    : `${CLI_POINTER_INSTRUCTIONS}\n\n${vaultInstructions}`;
}
