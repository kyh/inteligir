// What the agent's SHELL gets: the instance it can drive, and a PATH that can
// actually reach the CLI that drives it. Telling a model to run `inteligir`
// while the binary is not on its PATH is the whole feature failing quietly,
// so the bin directory is RESOLVED (never assumed) and the instructions only
// promise the command when it resolved.
//
// THE INSTANCE IS NAMED BY ITS DATA DIRECTORY, never by a URL and never by the
// token. An agent's cwd is the vault, not this checkout, so it cannot derive
// which instance it belongs to — but from the data dir the CLI reads
// `server.json` and learns the bound port AND the bearer together, so the two
// can never disagree and the credential never enters a child's environment.
//
// The bin dir is this program's OWN — the server and the CLI are one package,
// so there is nothing to resolve across a layout. It is still CHECKED for
// existence and the execute bit rather than assumed: npm strips the execute
// bit from a packed file it does not name in `bin`, and the failure mode is
// the command silently disappearing from a model's PATH.

import { accessSync, constants, statSync } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, dirname, join } from "node:path";
import { packageFile } from "../../paths";

const CLI_BIN_NAME = "inteligir";

/**
 * The dialect skills (@repo/agent-skills), resolved from wherever
 * this build's module graph put them — the agent reads them with its own shell
 * (`cat`, `rg`), the memory pattern's sibling. Null when the package cannot be
 * resolved (a packaged layout that did not stage the content), and the
 * instructions then simply do not promise them.
 */
export function resolveSkillsDir(): string | null {
  try {
    const require = createRequire(import.meta.url);
    const entry = require.resolve("@repo/agent-skills/skills/inteligir-notes/SKILL.md");
    const skills = dirname(dirname(entry));
    if (statSync(skills).isDirectory()) return skills;
  } catch {
    // Workspace resolution is the dev path; a published install resolves no
    // workspace package and reads the staged copy instead.
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

/**
 * The directory holding an executable `inteligir`, or null when this install
 * does not ship one. Verified on disk, so a broken packaging is null rather
 * than a PATH entry that resolves nothing.
 */
export function resolveCliBinDir(binDir: string = packageFile("bin")): string | null {
  return isExecutableFile(join(binDir, CLI_BIN_NAME)) ? binDir : null;
}

export interface AgentShellEnvArgs {
  /** WHICH instance — the data dir holding this boot's `server.json`. */
  dataDir: string;
  /** The host process's environment, whose PATH the agent shell inherits. */
  env: NodeJS.ProcessEnv;
  cliBinDir: string | null;
}

/** The Connected Folders rows composed onto a built env. A separate step
 *  because the list is Settings-mutable while the rest of the env is fixed at
 *  listen — the shellEnv thunk calls this with a fresh read. */
export function withConnectedDirs(env: AgentShellEnv, dirs: readonly string[]): AgentShellEnv {
  if (dirs.length === 0) {
    return env;
  }
  return { ...env, INTELIGIR_CONNECTED_DIRS: dirs.join(delimiter) };
}

/**
 * The env the runtime injects into the agent's shell. PATH is PREPENDED, not
 * replaced: the agent still needs git, node and everything else it inherits —
 * this only makes `inteligir` win over nothing.
 */
/** What the agent's shell inherits from this app, and nothing else. */
export interface AgentShellEnv {
  INTELIGIR_DATA_DIR: string;
  /** Present when the vendored dialect skills resolved on this layout. */
  INTELIGIR_SKILLS_DIR?: string;
  /** Present when Connected Folders are configured: os-delimited absolute
   *  dirs the user offers as read-only reference context (issue #601). Not a
   *  grant — the shell could already read them; this only names them. */
  INTELIGIR_CONNECTED_DIRS?: string;
  /** Present when the CLI's bin dir resolved — the PATH that reaches it. */
  PATH?: string;
}

export function buildAgentShellEnv(args: AgentShellEnvArgs): AgentShellEnv {
  const skillsDir = resolveSkillsDir();
  const base: AgentShellEnv = {
    INTELIGIR_DATA_DIR: args.dataDir,
  };
  if (skillsDir !== null) {
    base.INTELIGIR_SKILLS_DIR = skillsDir;
  }
  if (args.cliBinDir === null) {
    return base;
  }
  const inheritedPath = args.env.PATH ?? "";
  base.PATH =
    inheritedPath.length === 0 ? args.cliBinDir : `${args.cliBinDir}${delimiter}${inheritedPath}`;
  return base;
}
