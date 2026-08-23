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
full-text search, agent actions and comments. INTELIGIR_SERVER_URL and INTELIGIR_THREAD_ID \
are set in your environment. Run \`inteligir guide\` for the manual; every \
command takes \`--json\`.`;

/** Appended when the vendored dialect skills resolved: notes here persist the
 *  inteligir dialect, and the skills are its spec — three sentences of
 *  pointer, never the spec itself (the per-turn cost rule above). */
const SKILLS_POINTER_INSTRUCTIONS = `Notes in this vault use the inteligir markdown dialect \
(wiki links, {{formula}} pills, %%i:id%% comment anchors, inteligir-* fenced blocks). \
The dialect's own skills live in $INTELIGIR_SKILLS_DIR — read the relevant \
SKILL.md there (inteligir-notes first) before authoring or editing constructs, and \
follow it exactly; the app parses what it specifies.`;

/**
 * Cut to at most `maxBytes` of UTF-8 WITHOUT splitting a character. Measuring
 * `string.length` would count UTF-16 units (wrong for any non-BMP text) and
 * slicing by it can halve a surrogate pair, which reaches the model as U+FFFD.
 *
 * Exported because the per-turn view-context block caps the same way against a
 * much smaller budget: "cut UTF-8 to N bytes without splitting a code point"
 * must not get a second answer.
 */
export function headCapUtf8(text: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= maxBytes) {
    return text;
  }
  // fatal:false lets the decoder drop a trailing partial sequence rather than
  // throw; the cut is then on a real code-point boundary.
  const decoded = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes.subarray(0, maxBytes));
  return decoded.endsWith("�") ? decoded.slice(0, -1) : decoded;
}

/** One sentence, not a manifest: the paths are in $INTELIGIR_CONNECTED_DIRS
 *  too, and the phrasing states the USER'S INTENT (read-only reference) —
 *  nothing here can enforce it, so it must not claim to. */
function connectedFoldersInstructions(dirs: readonly string[]): string {
  return `The user connected these folders as reference context: \
${dirs.join(", ")} (also in $INTELIGIR_CONNECTED_DIRS). Treat them as \
read-only reference material — read freely, do not modify them.`;
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
  skillsDir?: string | null,
  connectedDirs?: readonly string[],
): string | undefined {
  const vaultInstructions = loadVaultInstructions(vaultDir);
  const parts: string[] = [];
  if (cliBinDir !== null) {
    parts.push(CLI_POINTER_INSTRUCTIONS);
  }
  if (skillsDir !== undefined && skillsDir !== null) {
    parts.push(SKILLS_POINTER_INSTRUCTIONS);
  }
  if (connectedDirs !== undefined && connectedDirs.length > 0) {
    parts.push(connectedFoldersInstructions(connectedDirs));
  }
  if (vaultInstructions !== undefined) {
    parts.push(vaultInstructions);
  }
  return parts.length === 0 ? undefined : parts.join("\n\n");
}
