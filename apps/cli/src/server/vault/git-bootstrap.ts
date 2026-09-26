import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { VAULT_TMP_PREFIX } from "@repo/notes/knowledge/vault-path";
import { CAPTURE_INBOX_PATH } from "@repo/notes/sync/reconcile-file";
import type { VaultRemoteSpec } from "../cloud/vault-remote";
import {
  gitPath,
  identityEnv,
  isMissingRemoteRepo,
  NETWORK_GIT_TIMEOUT_MS,
  runGit,
} from "./git-run";
import type { RunGit, RunGitCommand } from "./git-run";

export const ACCOUNT_MARKER_KEY = "inteligir.account";

// info/, not a committed file: the vault's files belong to the user. a template without info/
// (hooks only, say) leaves git with no such dir.
const ensureLocalInfoLine = async (
  git: RunGitCommand,
  root: string,
  rel: string,
  line: string,
): Promise<void> => {
  const file = await gitPath(git, root, rel);
  const existing = await readFile(file, "utf-8").catch(() => "");
  if (existing.split("\n").includes(line)) {
    return;
  }
  await mkdir(path.dirname(file), { recursive: true });
  const separator = existing === "" || existing.endsWith("\n") ? "" : "\n";
  await appendFile(file, `${separator}${line}\n`, "utf-8");
};

const hasHeadCommit = async (git: RunGitCommand): Promise<boolean> => {
  try {
    await git(["rev-parse", "--verify", "-q", "HEAD"]);
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
  const git: RunGitCommand = async (gitArgs) => await run(args.root, gitArgs, runOptions);
  // a file, not a dir, in a linked worktree or a submodule: either way the repo is there.
  if (!existsSync(path.join(args.root, ".git"))) {
    await git(["init", "-b", "main"]);
  }
  await ensureLocalInfoLine(git, args.root, "info/exclude", `${VAULT_TMP_PREFIX}*`);
  // the app writes both sides: two desktops each append their captures to the end of one file,
  // and a line merge of those appends wedges the rebase on a conflict nobody made. union keeps
  // both; a bullet deleted upstream beside the other device's append comes back. anchored, so a
  // nested Inbox.md merges like any note.
  await ensureLocalInfoLine(
    git,
    args.root,
    "info/attributes",
    `/${CAPTURE_INBOX_PATH} merge=union`,
  );
  if (created && cloned && remote?.source === "account" && remote.account.state === "known") {
    // so a later sign-in to a different account refuses rather than pushing these notes into it.
    await git(["config", ACCOUNT_MARKER_KEY, remote.account.id]);
  }
  // the hosted worker says "no repository" only for a truly absent repo (auth precedes it);
  // github answers 404 for a private repo the credential cannot see, so a byo not-found boots empty.
  const seedable = remote === null || (outcome === "missing" && remote.source === "account");
  if (created && seedable && args.seed) {
    await args.seed(args.root);
  }
  // the sync loop rebases, and a rebase needs a commit to stand on; nothing more. staging the
  // tree here hashes every file before the server listens, and a large folder opened as a vault
  // outlasts the shell's readiness wait. the runtime's boot sweep commits it after the listen.
  if (!(await hasHeadCommit(git))) {
    await run(
      args.root,
      ["-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "vault: initialize"],
      { env: { ...args.env, ...identityEnv() } },
    );
  }
  return { cloned, created };
};
