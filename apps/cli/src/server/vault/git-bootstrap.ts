import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { VAULT_TMP_PREFIX } from "@repo/notes/knowledge/vault-path";
import type { VaultRemoteSpec } from "../cloud/vault-remote";
import { identityEnv, isMissingRemoteRepo, NETWORK_GIT_TIMEOUT_MS, runGit } from "./git-run";
import type { RunGit } from "./git-run";

export const ACCOUNT_MARKER_KEY = "inteligir.account";

const ensureLocalExclude = async (root: string): Promise<void> => {
  // info/exclude, not .gitignore: the vault's files belong to the user.
  const excludePath = path.join(root, ".git", "info", "exclude");
  const pattern = `${VAULT_TMP_PREFIX}*`;
  const existing = await readFile(excludePath, "utf-8").catch(() => "");
  if (existing.split("\n").includes(pattern)) {
    return;
  }
  await appendFile(excludePath, `${pattern}\n`, "utf-8");
};

const hasHeadCommit = async (
  run: RunGit,
  root: string,
  env?: Record<string, string>,
): Promise<boolean> => {
  try {
    await run(root, ["rev-parse", "--verify", "-q", "HEAD"], env ? { env } : {});
    return true;
  } catch {
    return false;
  }
};

export interface EnsureVaultRepoArgs {
  root: string;
  // a seed that writes synchronously is a seed; the bootstrap awaits either.
  seed?: (root: string) => void | Promise<void>;
  remote?: VaultRemoteSpec | null;
  env?: Record<string, string>;
  // the full runGit, not RunGitCommand: the clone runs in the parent directory.
  run?: RunGit;
}

// "missing" (no repository at the remote) may seed: the first push creates it. "failed"
// (offline, refused credential) boots empty instead: seeding beside a populated remote plants
// a history the first sync must rebase through, and failing the boot would take down the
// server the user signs in through again. git removes its own partial clone dir on failure.
const tryCloneVault = async (
  run: RunGit,
  args: EnsureVaultRepoArgs,
  remote: VaultRemoteSpec,
): Promise<"cloned" | "missing" | "failed"> => {
  await mkdir(path.dirname(args.root), { recursive: true });
  try {
    await run(path.dirname(args.root), ["clone", "--", remote.url, args.root], {
      env: { ...args.env, ...remote.env },
      timeoutMs: NETWORK_GIT_TIMEOUT_MS,
    });
    return "cloned";
  } catch (error) {
    return isMissingRemoteRepo(error) ? "missing" : "failed";
  }
};

// an existing vault beside a populated remote is not merged here: the first sync pass
// surfaces unrelated histories as its conflict state.
export const ensureVaultRepo = async (
  args: EnsureVaultRepoArgs,
): Promise<{ created: boolean; cloned: boolean }> => {
  const run = args.run ?? runGit;
  const created = !existsSync(args.root);
  const remote = args.remote ?? null;
  const outcome =
    created && remote !== null ? await tryCloneVault(run, args, remote) : ("missing" as const);
  const cloned = outcome === "cloned";
  await mkdir(args.root, { recursive: true });
  const runOptions = args.env ? { env: args.env } : {};
  if (!existsSync(path.join(args.root, ".git"))) {
    await run(args.root, ["init", "-b", "main"], runOptions);
  }
  await ensureLocalExclude(args.root);
  if (created && remote?.source === "account" && remote.account !== undefined && cloned) {
    // so a later sign-in to a different account refuses rather than pushing these notes into it.
    await run(args.root, ["config", ACCOUNT_MARKER_KEY, remote.account], runOptions);
  }
  // the hosted worker says "no repository" only for a truly absent repo (auth precedes it);
  // github answers 404 for a private repo the credential cannot see, so a byo not-found boots empty.
  const seedable = remote === null || (outcome === "missing" && remote.source === "account");
  if (created && seedable && args.seed) {
    await args.seed(args.root);
  }
  // the sync loop rebases, and a rebase needs a commit to stand on.
  if (!(await hasHeadCommit(run, args.root, args.env))) {
    await run(args.root, ["add", "-A"], runOptions);
    await run(
      args.root,
      ["-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "vault: initialize"],
      { env: { ...args.env, ...identityEnv() } },
    );
  }
  return { cloned, created };
};
