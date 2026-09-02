// the instance is named by its data dir, never a URL or the token: from it the CLI reads server.json and gets
// port and bearer together, and the credential never enters a child's environment. env (`toShellEnv`) and prompt
// (`toInstructions`) are both pure functions of one AgentSessionFacts, so a variable one names is one the other carries.

import { accessSync, constants, statSync } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, dirname, join } from "node:path";
import { packageFile } from "../../paths";

const CLI_BIN_NAME = "inteligir";

export function resolveSkillsDir(): string | null {
  try {
    const require = createRequire(import.meta.url);
    const entry = require.resolve("@repo/agent-skills/skills/inteligir-notes/SKILL.md");
    const skills = dirname(dirname(entry));
    if (statSync(skills).isDirectory()) return skills;
  } catch {
    // a published install resolves no workspace package and reads the staged copy instead.
  }
  try {
    const staged = packageFile("dist/skills");
    return statSync(staged).isDirectory() ? staged : null;
  } catch {
    return null;
  }
}

function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) {
      return false;
    }
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// checked for the execute bit, not assumed: npm strips it from a packed file not named in `bin`.
export function resolveCliBinDir(binDir: string = packageFile("bin")): string | null {
  return isExecutableFile(join(binDir, CLI_BIN_NAME)) ? binDir : null;
}

// read per session open: connected folders are Settings-mutable, and a value captured at runtime build would freeze them.
export interface AgentSessionFacts {
  dataDir: string;
  cliBinDir: string | null;
  skillsDir: string | null;
  connectedDirs: readonly string[];
}

export interface AgentShellEnv {
  INTELIGIR_DATA_DIR: string;
  INTELIGIR_SKILLS_DIR?: string;
  INTELIGIR_CONNECTED_DIRS?: string;
  PATH?: string;
}

export function toShellEnv(facts: AgentSessionFacts, hostEnv: NodeJS.ProcessEnv): AgentShellEnv {
  const env: AgentShellEnv = { INTELIGIR_DATA_DIR: facts.dataDir };
  if (facts.skillsDir !== null) {
    env.INTELIGIR_SKILLS_DIR = facts.skillsDir;
  }
  if (facts.connectedDirs.length > 0) {
    env.INTELIGIR_CONNECTED_DIRS = facts.connectedDirs.join(delimiter);
  }
  if (facts.cliBinDir !== null) {
    const inheritedPath = hostEnv.PATH ?? "";
    env.PATH =
      inheritedPath.length === 0
        ? facts.cliBinDir
        : `${facts.cliBinDir}${delimiter}${inheritedPath}`;
  }
  return env;
}
