// What the agent's SHELL gets: the server it can drive, and a PATH that can
// actually reach the CLI that drives it. Telling a model to run `inteligir`
// while the binary is not on its PATH is the whole feature failing quietly,
// so the bin directory is RESOLVED (never assumed) and the instructions only
// promise the command when it resolved.
//
// Layout resolution mirrors main.ts's `resolveEntryLayout`: this module runs
// either from source under tsx (apps/app/src/node/agent/ — the CLI package is
// a sibling of the app package) or from the bundled entry (dist-node/, one
// level under the app package). Both land on the same
// `<apps-dir>/cli/bin/inteligir`, which is checked for existence and the
// execute bit rather than assumed present.

import { accessSync, constants, statSync } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
    // Workspace resolution is the dev path; the packaged layout stages the
    // content beside the app bundle instead (launcher build.mjs).
  }
  try {
    const staged = join(dirname(fileURLToPath(import.meta.url)), "..", "skills");
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
 * The directory holding an executable `inteligir`, or null when this
 * deployment does not ship one. Candidates are the two layouts this module
 * runs in; each is verified on disk, so a wrong guess is null rather than a
 * PATH entry that resolves nothing.
 */
export function resolveCliBinDir(moduleUrl: string = import.meta.url): string | null {
  const here = dirname(fileURLToPath(moduleUrl));
  const candidates = [
    // source: apps/app/src/node/agent → apps/cli/bin
    join(here, "..", "..", "..", "..", "cli", "bin"),
    // bundle: apps/app/dist-node → apps/cli/bin
    join(here, "..", "..", "cli", "bin"),
  ];
  for (const candidate of candidates) {
    if (isExecutableFile(join(candidate, CLI_BIN_NAME))) {
      return candidate;
    }
  }
  return null;
}

export interface AgentShellEnvArgs {
  /** Where this instance is listening — known only after listen. */
  serverUrl: string;
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
  INTELIGIR_SERVER_URL: string;
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
    INTELIGIR_SERVER_URL: args.serverUrl,
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
