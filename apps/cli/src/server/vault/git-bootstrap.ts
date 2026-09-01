// One responsibility: the repo BOOTSTRAP — create the vault directory if
// absent (cloning the remote when one is configured, else init + welcome
// seed) and always leave it with a born HEAD, because the sync loop rebases
// and a rebase needs a commit to stand on. Runs once per boot, before the
// engine exists.

import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { VAULT_TMP_PREFIX } from "@repo/notes/knowledge/vault-path";
import type { VaultRemoteSpec } from "../cloud/vault-remote";
import {
  identityEnv,
  isMissingRemoteRepo,
  NETWORK_GIT_TIMEOUT_MS,
  runGit,
  type RunGit,
} from "./git-run";

/** The vault-side account marker: which account's hosted repo this checkout
 *  has synced with. ONE spelling, read and written by the engine's
 *  cross-account fence and by the clone path here. */
export const ACCOUNT_MARKER_KEY = "inteligir.account";

async function ensureLocalExclude(root: string): Promise<void> {
  // .git/info/exclude, not a .gitignore: the staging pattern is machinery,
  // and the vault's files belong to the user.
  const excludePath = join(root, ".git", "info", "exclude");
  const pattern = `${VAULT_TMP_PREFIX}*`;
  const existing = await readFile(excludePath, "utf8").catch(() => "");
  if (existing.split("\n").includes(pattern)) {
    return;
  }
  await appendFile(excludePath, `${pattern}\n`, "utf8");
}

async function hasHeadCommit(
  run: RunGit,
  root: string,
  env?: Record<string, string>,
): Promise<boolean> {
  try {
    await run(root, ["rev-parse", "--verify", "-q", "HEAD"], env ? { env } : {});
    return true;
  } catch {
    return false;
  }
}

export interface EnsureVaultRepoArgs {
  root: string;
  /** Runs when the directory did not exist before this boot (the welcome seed). */
  seed?: (root: string) => Promise<void>;
  /** The remote as of boot. A NEW vault dir clones from it instead of
   *  init+seed, which is what makes a second device join an existing vault
   *  rather than colliding with it. */
  remote?: VaultRemoteSpec | null;
  env?: Record<string, string>;
  /** How git is invoked; the real binary unless a test drives the bootstrap
   *  through a fake — the same port shape git-history reads through. */
  run?: RunGit;
}

/**
 * Try to clone the configured remote into a root that does not exist yet,
 * and SAY which way it failed — the caller's seeding decision hangs on it:
 *
 * - "missing": the remote holds no repository (the hosted repo before its
 *   first push, an absent BYO path). Nothing existed to join, so the welcome
 *   seed is safe — the first push creates the remote.
 * - "failed": the remote may exist but could not answer (offline boot, a
 *   refused credential). Seeding HERE is the trap cubic's review named: a
 *   populated remote comes back later and the seed's history has to rebase
 *   through it. The vault boots EMPTY instead (one empty init commit, which
 *   `--empty=drop` discards on the eventual first sync), and a revoked
 *   credential surfaces as `unauthorized` rather than failing the boot —
 *   which would take down the very server the user re-pairs through.
 *
 * git cleans up its own partially-cloned directory on failure, so every
 * fall-through starts from the same absent root.
 */
async function tryCloneVault(
  run: RunGit,
  args: EnsureVaultRepoArgs,
  remote: VaultRemoteSpec,
): Promise<"cloned" | "missing" | "failed"> {
  await mkdir(dirname(args.root), { recursive: true });
  try {
    await run(dirname(args.root), ["clone", "--", remote.url, args.root], {
      timeoutMs: NETWORK_GIT_TIMEOUT_MS,
      env: { ...args.env, ...remote.env },
    });
    return "cloned";
  } catch (error) {
    return isMissingRemoteRepo(error) ? "missing" : "failed";
  }
}

/**
 * Create the vault directory if absent — cloning the remote when one is
 * configured, else `git init` + seed — and always leave it with a born HEAD:
 * the sync loop rebases, and a rebase needs a commit to stand on.
 *
 * An EXISTING local vault beside a populated remote is deliberately not
 * merged here: the first sync pass rebases, and unrelated histories surface
 * as its typed `conflict` state rather than any silent resolution.
 */
export async function ensureVaultRepo(
  args: EnsureVaultRepoArgs,
): Promise<{ created: boolean; cloned: boolean }> {
  const run = args.run ?? runGit;
  const created = !existsSync(args.root);
  const remote = args.remote ?? null;
  const outcome =
    created && remote !== null ? await tryCloneVault(run, args, remote) : ("missing" as const);
  const cloned = outcome === "cloned";
  await mkdir(args.root, { recursive: true });
  const runOptions = args.env ? { env: args.env } : {};
  if (!existsSync(join(args.root, ".git"))) {
    await run(args.root, ["init", "-b", "main"], runOptions);
  }
  await ensureLocalExclude(args.root);
  if (created && remote?.source === "paired" && remote.account !== undefined && cloned) {
    // The clone came from this account's repo; pin it so a later re-pair to
    // a DIFFERENT account refuses instead of pushing these notes into it.
    await run(args.root, ["config", ACCOUNT_MARKER_KEY, remote.account], runOptions);
  }
  // The welcome seed runs with NO remote, or when the HOSTED remote itself
  // answered "no repository" — which our Worker says only for a truly absent
  // repo (auth precedes it). An EXPLICIT remote's "not found" is ambiguous:
  // GitHub answers 404 for a private repo the credential cannot see, and
  // seeding beside it plants the unrelated history the eventual first sync
  // conflicts through. Those boot empty instead.
  const seedable = remote === null || (outcome === "missing" && remote.source === "paired");
  if (created && seedable && args.seed) {
    await args.seed(args.root);
  }
  if (!(await hasHeadCommit(run, args.root, args.env))) {
    await run(args.root, ["add", "-A"], runOptions);
    await run(
      args.root,
      ["-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "vault: initialize"],
      { env: { ...args.env, ...identityEnv() } },
    );
  }
  return { created, cloned };
}
