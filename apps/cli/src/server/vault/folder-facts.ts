// What a folder already is, asked before it becomes a vault and by every pass after: whether it
// holds a repo, where that repo syncs, and whether another service syncs the folder. One reader,
// so a picker that asks and the boot that follows agree.

import { existsSync, statSync } from "node:fs";
import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import type { ExternalSync } from "@repo/api/local/vault/vault-schema";
import { isDocPath } from "@repo/notes/knowledge/doc-file";
import { hostedVaultRemoteUrl, NO_ORIGIN, ownOriginUrl } from "../cloud/vault-remote";
import type { OriginConfig } from "../cloud/vault-remote";
import { detectExternalSync, nodeExternalSyncDeps } from "./external-sync";
import { redactRemoteUrl, runGit } from "./git-run";
import type { RunGitCommand } from "./git-run";

// set beside the hosted url whenever the app writes it, so an origin the app manages is told from
// one the user set, and unset when an explicit remote takes the origin over.
export const REMOTE_MARKER_KEY = "inteligir.remote";
export const REMOTE_MARKER_ACCOUNT = "account";

// a POSIX extended regex over canonical key names, since git lowercases a section and a key; both
// in one spawn, which each status and each pass pay.
const ORIGIN_CONFIG_KEYS = String.raw`^(remote\.origin\.url|inteligir\.remote)$`;
const ORIGIN_URL_KEY = "remote.origin.url";

export const readOriginConfig = async (git: RunGitCommand): Promise<OriginConfig> => {
  let stdout: string;
  try {
    ({ stdout } = await git(["config", "--null", "--get-regexp", ORIGIN_CONFIG_KEYS]));
  } catch {
    // neither key set exits 1; a config git cannot read is no origin either, and the pass's own
    // steps fail on it before anything is pushed.
    return NO_ORIGIN;
  }
  let url: string | null = null;
  let markedAccount = false;
  // `--null`: each entry is its key, a newline, its value, then NUL. a later value wins, as git's
  // own `--get` answers.
  for (const entry of stdout.split("\0")) {
    const newline = entry.indexOf("\n");
    const key = newline === -1 ? entry : entry.slice(0, newline);
    const value = newline === -1 ? "" : entry.slice(newline + 1);
    if (key === ORIGIN_URL_KEY) {
      url = value.length > 0 ? value : null;
    } else if (key === REMOTE_MARKER_KEY) {
      markedAccount = value === REMOTE_MARKER_ACCOUNT;
    }
  }
  return { markedAccount, url };
};

interface NoteCount {
  count: number;
  // the walk stopped at its bound, so `count` is a floor
  capped: boolean;
}

export type VaultFolderFacts =
  | { exists: false; externalSync: ExternalSync | null }
  | {
      exists: true;
      // its own `.git`; a folder inside another repo is not one, and would get its own
      isRepo: boolean;
      // an origin the user set, redacted, which it keeps syncing with instead of the hosted vault
      remote: string | null;
      externalSync: ExternalSync | null;
      noteCount: NoteCount;
    };

// enough to say "about this many notes" without walking a code checkout's dependencies whole
const NOTE_WALK_MAX_ENTRIES = 20_000;

// dot-entries skipped: `.git`, `.obsidian` and the app's own folder hold no note of the user's
const countNotes = async (dir: string): Promise<NoteCount> => {
  let visited = 0;
  let count = 0;
  const pending = [dir];
  for (let current = pending.pop(); current !== undefined; current = pending.pop()) {
    let entries: Dirent[];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      visited += 1;
      if (visited > NOTE_WALK_MAX_ENTRIES) {
        return { capped: true, count };
      }
      if (entry.name.startsWith(".")) {
        continue;
      }
      if (entry.isDirectory()) {
        pending.push(path.join(current, entry.name));
      } else if (entry.isFile() && isDocPath(entry.name)) {
        count += 1;
      }
    }
  }
  return { capped: false, count };
};

const isDirectory = (dir: string): boolean => {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
};

export interface InspectVaultFolderContext {
  homeDir: string;
  cloudUrl: string;
  // the desktop's main runs no git of its own, and on a Mac without the developer tools the one on
  // its PATH is the stub that offers the install, so main hands over the git its server runs
  gitEnv?: Record<string, string>;
}

export const inspectVaultFolder = async (
  dir: string,
  context: InspectVaultFolderContext,
): Promise<VaultFolderFacts> => {
  const externalSync = detectExternalSync(dir, nodeExternalSyncDeps(context.homeDir));
  if (!isDirectory(dir)) {
    return { exists: false, externalSync };
  }
  // only its own: git run in a folder inside another repo would read that repo's origin.
  const isRepo = existsSync(path.join(dir, ".git"));
  const gitOptions = context.gitEnv === undefined ? {} : { env: context.gitEnv };
  const origin = isRepo
    ? await readOriginConfig(async (gitArgs) => await runGit(dir, gitArgs, gitOptions))
    : NO_ORIGIN;
  const own = ownOriginUrl(origin, hostedVaultRemoteUrl(context.cloudUrl));
  return {
    exists: true,
    externalSync,
    isRepo,
    noteCount: await countNotes(dir),
    remote: own === null ? null : redactRemoteUrl(own),
  };
};
