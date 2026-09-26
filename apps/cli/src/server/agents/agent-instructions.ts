import { readFileSync } from "node:fs";
import path from "node:path";
import { errnoCode } from "../errno";
import { headCapUtf8 } from "../head-cap-utf8";
import type { AgentSessionFacts } from "./agent-shell-env";

const AGENT_INSTRUCTIONS_FILE = "AGENTS.md";
const AGENT_INSTRUCTIONS_MAX_BYTES = 32_768;

export const AUDIENCE_INSTRUCTIONS = `The person you are working with keeps notes in this app; \
they are not a developer. Talk to them in plain language about their notes. Do not mention git, \
commits, the terminal or the command line unless they ask, and never ask them to run a command.`;

export const CLI_POINTER_INSTRUCTIONS = `The \`inteligir\` CLI drives this notes app from your shell: vault file CRUD, \
full-text search, agent actions and comments. INTELIGIR_DATA_DIR and INTELIGIR_THREAD_ID \
are set in your environment. Run \`inteligir guide\` for the manual; every \
command takes \`--json\`.`;

const SKILLS_POINTER_INSTRUCTIONS = `Notes in this vault use the inteligir markdown dialect \
(wiki links, {{formula}} pills, %%i:id%% comment anchors, inteligir-* fenced blocks). \
The dialect's own skills live in $INTELIGIR_SKILLS_DIR — read the relevant \
SKILL.md there (inteligir-notes first) before authoring or editing constructs, and \
follow it exactly; the app parses what it specifies.`;

// states the user's intent only: nothing here can enforce read-only, so the wording must not claim to.
const connectedFoldersInstructions = (dirs: readonly string[]): string =>
  `The user connected these folders as reference context: \
${dirs.join(", ")} (also in $INTELIGIR_CONNECTED_DIRS). Treat them as \
read-only reference material — read freely, do not modify them.`;

const loadVaultInstructions = (vaultDir: string): string | undefined => {
  let raw: string;
  try {
    raw = readFileSync(path.join(vaultDir, AGENT_INSTRUCTIONS_FILE), "utf-8");
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
};

// each pointer is stated only when `toShellEnv` keeps the promise from the same facts. the
// audience leads and the vault's own AGENTS.md closes, so a vault's instruction is the last word.
export const toInstructions = (facts: AgentSessionFacts, vaultDir: string): string => {
  const parts: string[] = [AUDIENCE_INSTRUCTIONS];
  if (facts.cliBinDir !== null) {
    parts.push(CLI_POINTER_INSTRUCTIONS);
  }
  if (facts.skillsDir !== null) {
    parts.push(SKILLS_POINTER_INSTRUCTIONS);
  }
  if (facts.connectedDirs.length > 0) {
    parts.push(connectedFoldersInstructions(facts.connectedDirs));
  }
  const vaultInstructions = loadVaultInstructions(vaultDir);
  if (vaultInstructions !== undefined) {
    parts.push(vaultInstructions);
  }
  return parts.join("\n\n");
};
