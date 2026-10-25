import { readFileSync } from "node:fs";
import { LIBRARY_RULES_PATH } from "@repo/notes/items/item-kind";
import path from "node:path";
import { errnoCode } from "../errno";
import { headCapUtf8 } from "../head-cap-utf8";
import type { PromptFacts } from "./action-preset-prompt";
import type { AgentSessionFacts } from "./agent-shell-env";

const AGENT_INSTRUCTIONS_FILE = LIBRARY_RULES_PATH;
const AGENT_INSTRUCTIONS_MAX_BYTES = 32_768;

export const AUDIENCE_INSTRUCTIONS = `The person you are working with keeps a library in this app: \
links and articles they saved, images, PDFs and files, and notes they wrote; they are not a \
developer. Talk to them in plain language about their library and its items, folders and tags, \
never about files, the vault or markdown, which are only how the app keeps them. Do not mention \
git, commits, the terminal or the command line unless they ask, and never ask them to run a \
command.`;

export const CLI_POINTER_INSTRUCTIONS = `The \`inteligir\` CLI drives this library from your shell: \
save links and files, list and tag items, read and write the library's files (its \`vault\` \
commands), search, actions and annotations. INTELIGIR_DATA_DIR and INTELIGIR_THREAD_ID are set \
in your environment. Run \`inteligir guide\` for the manual; every command takes \`--json\`.`;

const SKILLS_POINTER_INSTRUCTIONS = `Every item in this library is a markdown file in the inteligir \
dialect (wiki links, {{formula}} pills, %%i:id%% annotation markers, inteligir-* fenced blocks). \
The dialect's own skills live in $INTELIGIR_SKILLS_DIR: read inteligir-notes first, and \
inteligir-items before saving, filing or tagging an item, then the SKILL.md for any construct \
you author or edit, and follow it exactly; the app parses what it specifies.`;

// the library's AGENTS.md is the person's own filing rules, said as theirs
const LIBRARY_RULES_HEADER =
  "The library's own instructions (its AGENTS.md, the person's filing rules):";

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
  const vaultInstructions = loadVaultInstructions(vaultDir);
  if (vaultInstructions !== undefined) {
    parts.push(`${LIBRARY_RULES_HEADER}\n\n${vaultInstructions}`);
  }
  return parts.join("\n\n");
};

// the library holds filing rules of its own, which the instructions then carry
export const hasLibraryInstructions = (vaultDir: string): boolean =>
  loadVaultInstructions(vaultDir) !== undefined;

// what a turn's preset and library blocks may name: the CLI only when its binary resolved, the
// filing rules only when the instructions carry them
export const promptFactsFor = (facts: AgentSessionFacts, vaultDir: string): PromptFacts => ({
  cli: facts.cliBinDir !== null,
  filingRules: hasLibraryInstructions(vaultDir),
});
