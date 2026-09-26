// against real git: the parse frames git's own -z bytes, so a fake would only prove the fake.

import { existsSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import nodePath from "node:path";
import { describe, expect, it } from "vitest";
import { ensureVaultRepo } from "../git-bootstrap";
import { ENGINE_IDENTITY, identityEnv, runGit } from "../git-run";
import type { RunGitCommand } from "../git-run";
import {
  cachedDeletionLog,
  parseDeletionLog,
  parseFollowLog,
  readDeletedNotes,
  readNoteHistory,
  readNoteRevision,
  readTurnCommits,
} from "../git-history";
import { AGENT_COMMIT_AUTHOR, agentCommitMessage, undoCommitMessage } from "../turn-trailers";
import { VaultServiceError } from "../vault-service";
import { hermeticGitEnv } from "./git-test-env";
import { makeTempDir } from "../../__tests__/temp-dir";

// vitest types its asymmetric matchers `any`; naming one keeps the assertion typed.
const anIsoTimestamp: unknown = expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/u);

const env = hermeticGitEnv();

const IDENTITY = {
  GIT_AUTHOR_EMAIL: "a@b.c",
  GIT_AUTHOR_NAME: "A",
  GIT_COMMITTER_EMAIL: "a@b.c",
  GIT_COMMITTER_NAME: "A",
};

const makeVault = async (): Promise<{
  root: string;
  run: (args: readonly string[]) => Promise<{ stdout: string }>;
  commit: (subject: string, extraEnv?: Record<string, string>) => Promise<void>;
  // as the committer, which a rebase needs.
  runAs: (args: readonly string[]) => Promise<{ stdout: string }>;
}> => {
  const root = makeTempDir("inteligir-history-");
  await ensureVaultRepo({ env, root });
  const run = async (args: readonly string[], options?: { env?: Record<string, string> }) =>
    await runGit(root, args, { env: { ...env, ...options?.env } });
  return {
    commit: async (subject, extraEnv) => {
      await run(["add", "-A"]);
      await run(["-c", "commit.gpgsign=false", "commit", "-m", subject], {
        env: { ...IDENTITY, ...extraEnv },
      });
    },
    root,
    run,
    runAs: async (args) => await run(args, { env: IDENTITY }),
  };
};

describe("parseFollowLog", () => {
  it("frames a commit with no name-status block against the newer row's path", () => {
    const stdout = [`${"abc".repeat(13)}d`, "2026-01-01T00:00:00+00:00", "A", "a@b.c", "s"].join(
      "\0",
    );
    expect(parseFollowLog(stdout, "Note.md")).toEqual([
      {
        authorEmail: "a@b.c",
        authorKind: "external",
        authorName: "A",
        authoredAt: "2026-01-01T00:00:00+00:00",
        path: "Note.md",
        sha: `${"abc".repeat(13)}d`,
        subject: "s",
      },
    ]);
  });

  it("stops rather than mis-framing bytes that are not a commit record", () => {
    expect(parseFollowLog("not-a-sha\0anything", "Note.md")).toEqual([]);
  });

  it("reads a path that itself begins with a newline as a path, not a status", () => {
    const fields = ["0".repeat(40), "2026-01-01T00:00:00+00:00", "A", "a@b.c", "s"];
    const stdout = [...fields, "\nM", "\nodd name.md", ""].join("\0");
    expect(parseFollowLog(stdout, "Note.md")[0]?.path).toBe("\nodd name.md");
  });
});

describe("readNoteHistory", () => {
  it("follows a note across renames and reports the path at each revision", async () => {
    const { root, run, commit } = await makeVault();
    await writeFile(nodePath.join(root, "a note.md"), "one\n", "utf-8");
    await commit("vault: update a note.md");
    await rename(nodePath.join(root, "a note.md"), nodePath.join(root, "ünïcode nöte.md"));
    await commit("vault: rename");
    await writeFile(nodePath.join(root, "ünïcode nöte.md"), "one\ntwo\n", "utf-8");
    await commit("vault: update ünïcode nöte.md");

    const revisions = await readNoteHistory(run, "ünïcode nöte.md", { limit: 50, skip: 0 });
    expect(revisions.map((revision) => revision.subject)).toEqual([
      "vault: update ünïcode nöte.md",
      "vault: rename",
      "vault: update a note.md",
    ]);
    expect(revisions.map((revision) => revision.path)).toEqual([
      "ünïcode nöte.md",
      "ünïcode nöte.md",
      "a note.md",
    ]);
    expect(revisions[1]?.renamedFrom).toBe("a note.md");
    expect(revisions[0]?.renamedFrom).toBeUndefined();
    expect(revisions[0]?.authorName).toBe("A");
    expect(revisions[0]?.authoredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
  });

  it("paginates with skip and limit", async () => {
    const { root, run, commit } = await makeVault();
    for (const index of [1, 2, 3]) {
      await writeFile(nodePath.join(root, "Note.md"), `line ${String(index)}\n`, "utf-8");
      await commit(`vault: update ${String(index)}`);
    }
    const page = await readNoteHistory(run, "Note.md", { limit: 1, skip: 1 });
    expect(page.map((revision) => revision.subject)).toEqual(["vault: update 2"]);
  });

  it("frames a commit that reports MORE THAN ONE status for the followed path", async () => {
    // a note that became a folder and a note again reports two statuses in one commit.
    const { root, run, commit } = await makeVault();
    await writeFile(nodePath.join(root, "Note.md"), "one\n", "utf-8");
    await commit("vault: first");
    await rm(nodePath.join(root, "Note.md"));
    await mkdir(nodePath.join(root, "Note.md"), { recursive: true });
    await writeFile(nodePath.join(root, "Note.md", "child"), "child\n", "utf-8");
    await commit("vault: folder");
    await rm(nodePath.join(root, "Note.md"), { recursive: true });
    await writeFile(nodePath.join(root, "Note.md"), "three\n", "utf-8");
    await commit("vault: file again");

    const revisions = await readNoteHistory(run, "Note.md", { limit: 50, skip: 0 });
    expect(revisions.map((revision) => revision.subject)).toEqual([
      "vault: file again",
      "vault: folder",
      "vault: first",
    ]);
    expect(revisions[0]?.path).toBe("Note.md");
  });

  it("takes a note's name literally — a pathspec is otherwise a GLOB", async () => {
    // [a].md as a pathspec matches a.md, so the history would carry another note's revisions.
    const { root, run, commit } = await makeVault();
    await writeFile(nodePath.join(root, "a.md"), "plain\n", "utf-8");
    await writeFile(nodePath.join(root, "[a].md"), "bracketed\n", "utf-8");
    await commit("vault: both");
    await writeFile(nodePath.join(root, "a.md"), "plain edited\n", "utf-8");
    await commit("vault: only a.md");

    const revisions = await readNoteHistory(run, "[a].md", { limit: 50, skip: 0 });
    expect(revisions.map((revision) => revision.subject)).toEqual(["vault: both"]);
  });

  it("drops a revision that only DELETED the note — every row it lists is readable", async () => {
    const { root, run, commit } = await makeVault();
    await writeFile(nodePath.join(root, "Note.md"), "one\n", "utf-8");
    await commit("vault: create");
    await rm(nodePath.join(root, "Note.md"));
    await commit("vault: delete");
    await writeFile(nodePath.join(root, "Note.md"), "again\n", "utf-8");
    await commit("vault: recreate");

    const revisions = await readNoteHistory(run, "Note.md", { limit: 50, skip: 0 });
    expect(revisions.map((revision) => revision.subject)).not.toContain("vault: delete");
    for (const revision of revisions) {
      await expect(readNoteRevision(run, revision.path, revision.sha)).resolves.toEqual(
        expect.any(String),
      );
    }
  });

  it("names who wrote each revision from its author: the app, an agent, or anyone else", async () => {
    const { root, run, commit } = await makeVault();
    const edit = async (line: string, author: Record<string, string>): Promise<void> => {
      await writeFile(nodePath.join(root, "Note.md"), `${line}\n`, "utf-8");
      await commit(`edit ${line}`, author);
    };
    await edit("engine", identityEnv("Test Mac"));
    await edit("agent", identityEnv("Test Mac", AGENT_COMMIT_AUTHOR));
    // a phone's commit names its device
    await edit("phone", {
      GIT_AUTHOR_EMAIL: "dev_1@devices.test",
      GIT_AUTHOR_NAME: "Kai's iPhone",
    });

    const revisions = await readNoteHistory(run, "Note.md", { limit: 50, skip: 0 });
    expect(revisions.map(({ authorKind, authorName }) => [authorKind, authorName])).toEqual([
      ["external", "Kai's iPhone"],
      ["agent", AGENT_COMMIT_AUTHOR.name],
      ["app", ENGINE_IDENTITY.name],
    ]);
  });

  it("answers an empty page for a path git has never seen", async () => {
    const { run } = await makeVault();
    expect(await readNoteHistory(run, "Never.md", { limit: 50, skip: 0 })).toEqual([]);
  });
});

describe("readNoteRevision", () => {
  it("reads the bytes a note held at its own historical path", async () => {
    const { root, run, commit } = await makeVault();
    await writeFile(nodePath.join(root, "Old.md"), "before\n", "utf-8");
    await commit("vault: update Old.md");
    // the rename is its own commit: git detects renames by similarity, so one that also rewrites the body is a delete plus an add.
    await rename(nodePath.join(root, "Old.md"), nodePath.join(root, "New.md"));
    await commit("vault: rename Old.md");
    await writeFile(nodePath.join(root, "New.md"), "after\n", "utf-8");
    await commit("vault: update New.md");

    const revisions = await readNoteHistory(run, "New.md", { limit: 50, skip: 0 });
    const oldest = revisions.at(-1);
    expect(oldest?.path).toBe("Old.md");
    expect(await readNoteRevision(run, oldest?.path ?? "", oldest?.sha ?? "")).toBe("before\n");
  });

  it("refuses not_found for a path absent at that revision", async () => {
    const { root, run, commit } = await makeVault();
    await writeFile(nodePath.join(root, "Note.md"), "x\n", "utf-8");
    await commit("vault: update Note.md");
    const [head] = await readNoteHistory(run, "Note.md", { limit: 1, skip: 0 });
    await expect(readNoteRevision(run, "Missing.md", head?.sha ?? "")).rejects.toThrow(
      VaultServiceError,
    );
  });

  it("refuses not_found when the path names a folder at that revision", async () => {
    const { root, run, commit } = await makeVault();
    await mkdir(nodePath.join(root, "notes"), { recursive: true });
    await writeFile(nodePath.join(root, "notes", "Note.md"), "x\n", "utf-8");
    await commit("vault: update notes/Note.md");
    const [head] = await readNoteHistory(run, "notes/Note.md", { limit: 1, skip: 0 });
    // a folder is a legal vault path: the object exists at that revision and is a tree.
    await expect(readNoteRevision(run, "notes", head?.sha ?? "")).rejects.toThrow(
      VaultServiceError,
    );
  });
});

describe("parseDeletionLog", () => {
  it("frames each commit's first parent, date and deleted paths", () => {
    const sha = "a".repeat(40);
    const parent = "b".repeat(40);
    const stdout = [
      sha,
      `${parent} ${"c".repeat(40)}`,
      "2026-01-01T00:00:00+00:00",
      "\nD",
      "one.md",
      "D",
      "two.md",
      "",
    ].join("\0");
    expect(parseDeletionLog(stdout)).toEqual([
      { deletedAt: "2026-01-01T00:00:00+00:00", parent, paths: ["one.md", "two.md"] },
    ]);
  });

  it("stops rather than mis-framing bytes that are not a commit record", () => {
    expect(parseDeletionLog("not-a-sha\0anything")).toEqual([]);
  });
});

const onDisk = (root: string) => (path: string) => existsSync(nodePath.join(root, path));

// every note committed, then `deleted` removed in a commit of its own.
const vaultWithDeletion = async (notes: readonly string[], deleted: string) => {
  const vault = await makeVault();
  for (const note of notes) {
    await writeFile(nodePath.join(vault.root, note), `${note}\n`, "utf-8");
  }
  await vault.commit("vault: create");
  await rm(nodePath.join(vault.root, deleted));
  await vault.commit(`vault: delete ${deleted}`);
  return vault;
};

const readDeleted = async (run: RunGitCommand, root: string) =>
  await readDeletedNotes(run, cachedDeletionLog(run), onDisk(root));

// counts the deletion walks alone: rev-parse and ls-files run on every read by design.
const countingWalks = (run: RunGitCommand) => {
  let walks = 0;
  const counted: RunGitCommand = async (args) => {
    if (args.includes("log")) {
      walks += 1;
    }
    return await run(args);
  };
  return { run: counted, walks: () => walks };
};

describe("readDeletedNotes", () => {
  it("lists a committed deletion under the parent whose tree still holds the bytes, docs only", async () => {
    const { root, run, commit } = await makeVault();
    await writeFile(nodePath.join(root, "Gone.md"), "bytes\n", "utf-8");
    await writeFile(nodePath.join(root, "Gone.md.comments.json"), "{}", "utf-8");
    await writeFile(nodePath.join(root, "Kept.md"), "kept\n", "utf-8");
    await commit("vault: create");
    const [created] = await readNoteHistory(run, "Gone.md", { limit: 1, skip: 0 });
    await rm(nodePath.join(root, "Gone.md"));
    await rm(nodePath.join(root, "Gone.md.comments.json"));
    await commit("vault: delete");

    const entries = await readDeleted(run, root);
    expect(entries).toEqual([
      {
        deletedAt: anIsoTimestamp,
        path: "Gone.md",
        sha: created?.sha,
      },
    ]);
    expect(await readNoteRevision(run, "Gone.md", entries[0]?.sha ?? "")).toBe("bytes\n");
  });

  it("lists a deletion the auto-commit has not flushed under HEAD", async () => {
    const { root, run, commit } = await makeVault();
    await writeFile(nodePath.join(root, "Fresh.md"), "fresh\n", "utf-8");
    await commit("vault: create");
    await rm(nodePath.join(root, "Fresh.md"));

    const entries = await readDeleted(run, root);
    const headRef = await run(["rev-parse", "HEAD"]);
    const head = headRef.stdout.trim();
    expect(entries).toEqual([{ deletedAt: anIsoTimestamp, path: "Fresh.md", sha: head }]);
    expect(Number.isNaN(Date.parse(entries[0]?.deletedAt ?? ""))).toBe(false);
    expect(await readNoteRevision(run, "Fresh.md", head)).toBe("fresh\n");
  });

  it("names a path once, at its latest deletion, and not at all once it is back on disk", async () => {
    const { root, run, commit } = await makeVault();
    await writeFile(nodePath.join(root, "Twice.md"), "first\n", "utf-8");
    await writeFile(nodePath.join(root, "Back.md"), "back\n", "utf-8");
    await commit("vault: create");
    await rm(nodePath.join(root, "Twice.md"));
    await rm(nodePath.join(root, "Back.md"));
    await commit("vault: delete both");
    await writeFile(nodePath.join(root, "Twice.md"), "second\n", "utf-8");
    await commit("vault: recreate Twice");
    await rm(nodePath.join(root, "Twice.md"));
    await commit("vault: delete Twice again");
    // re-created and not yet committed: on disk is on disk.
    await writeFile(nodePath.join(root, "Back.md"), "back again\n", "utf-8");

    const entries = await readDeleted(run, root);
    expect(entries.map((entry) => entry.path)).toEqual(["Twice.md"]);
    expect(await readNoteRevision(run, "Twice.md", entries[0]?.sha ?? "")).toBe("second\n");
  });

  it("does not report a rename as a deletion", async () => {
    const { root, run, commit } = await makeVault();
    await writeFile(nodePath.join(root, "Old.md"), "same bytes\n", "utf-8");
    await commit("vault: create");
    await rename(nodePath.join(root, "Old.md"), nodePath.join(root, "New.md"));
    await commit("vault: rename");

    expect(await readDeleted(run, root)).toEqual([]);
  });

  it("walks from HEAD even when a vault file is named like its sha", async () => {
    const { root, run } = await vaultWithDeletion(["Gone.md"], "Gone.md");
    const { stdout } = await run(["rev-parse", "HEAD"]);
    await writeFile(nodePath.join(root, stdout.trim()), "named like a commit\n", "utf-8");

    const entries = await readDeleted(run, root);
    expect(entries.map((entry) => entry.path)).toEqual(["Gone.md"]);
  });
});

describe("cachedDeletionLog", () => {
  it("walks the log once while HEAD stands, and again once a commit deletes a note", async () => {
    const { root, run, commit } = await vaultWithDeletion(["Gone.md", "Later.md"], "Gone.md");
    const counted = countingWalks(run);
    const deletionLog = cachedDeletionLog(counted.run);

    const first = await readDeletedNotes(counted.run, deletionLog, onDisk(root));
    const second = await readDeletedNotes(counted.run, deletionLog, onDisk(root));
    expect(first.map((entry) => entry.path)).toEqual(["Gone.md"]);
    expect(second).toEqual(first);
    expect(counted.walks()).toBe(1);

    await rm(nodePath.join(root, "Later.md"));
    await commit("vault: delete Later.md");
    const third = await readDeletedNotes(counted.run, deletionLog, onDisk(root));
    expect(third.map((entry) => entry.path)).toEqual(["Later.md", "Gone.md"]);
    expect(counted.walks()).toBe(2);
  });

  it("reads the unflushed deletions and the disk on every call", async () => {
    const { root, run } = await vaultWithDeletion(["Gone.md", "Fresh.md"], "Gone.md");
    const counted = countingWalks(run);
    const deletionLog = cachedDeletionLog(counted.run);
    await readDeletedNotes(counted.run, deletionLog, onDisk(root));

    await rm(nodePath.join(root, "Fresh.md"));
    const unflushed = await readDeletedNotes(counted.run, deletionLog, onDisk(root));
    expect(unflushed.map((entry) => entry.path)).toEqual(["Fresh.md", "Gone.md"]);

    await writeFile(nodePath.join(root, "Gone.md"), "back\n", "utf-8");
    const recreated = await readDeletedNotes(counted.run, deletionLog, onDisk(root));
    expect(recreated.map((entry) => entry.path)).toEqual(["Fresh.md"]);
    expect(counted.walks()).toBe(1);
  });

  it("shares one walk between reads that overlap", async () => {
    const { root, run } = await vaultWithDeletion(["Gone.md"], "Gone.md");
    const counted = countingWalks(run);
    const deletionLog = cachedDeletionLog(counted.run);

    const reads = await Promise.all(
      [1, 2, 3].map(async () => await readDeletedNotes(counted.run, deletionLog, onDisk(root))),
    );
    expect(reads.map((entries) => entries.map((entry) => entry.path))).toEqual([
      ["Gone.md"],
      ["Gone.md"],
      ["Gone.md"],
    ]);
    expect(counted.walks()).toBe(1);
  });

  it("walks again after a walk that failed", async () => {
    const { root, run } = await vaultWithDeletion(["Gone.md"], "Gone.md");
    let failures = 1;
    const flaky: RunGitCommand = async (args) => {
      if (args.includes("log") && failures > 0) {
        failures -= 1;
        throw new Error("log failed");
      }
      return await run(args);
    };
    const deletionLog = cachedDeletionLog(flaky);

    await expect(readDeletedNotes(flaky, deletionLog, onDisk(root))).rejects.toThrow("log failed");
    const entries = await readDeletedNotes(flaky, deletionLog, onDisk(root));
    expect(entries.map((entry) => entry.path)).toEqual(["Gone.md"]);
  });
});

// the walk's bound: every commit a test makes, but one dated otherwise on purpose, is after it.
const aMinuteAgo = (): number => Date.now() - 60_000;

describe("readTurnCommits", () => {
  it("finds a turn's commit after a rebase replays it onto another device's commit", async () => {
    const { root, run, runAs, commit } = await makeVault();
    await run(["branch", "other-device"]);
    await writeFile(nodePath.join(root, "note.md"), "the agent's edit\n", "utf-8");
    await commit(agentCommitMessage("thr_1", "turn_1"));
    const [before] = await readTurnCommits(run, { since: aMinuteAgo(), threadId: "thr_1" });

    await run(["switch", "-q", "other-device"]);
    await writeFile(nodePath.join(root, "other.md"), "pushed by another device\n", "utf-8");
    await commit("vault: update other.md");
    const { stdout: otherTip } = await run(["rev-parse", "HEAD"]);
    await run(["switch", "-q", "main"]);
    await runAs(["-c", "commit.gpgsign=false", "rebase", "-q", "other-device"]);

    const after = await readTurnCommits(run, { since: aMinuteAgo(), threadId: "thr_1" });
    expect(after).toHaveLength(1);
    expect(after[0]?.sha).not.toBe(before?.sha);
    expect(after[0]?.parent).toBe(otherTip.trim());
    expect(after[0]?.trailers).toEqual({ kind: "turn", threadId: "thr_1", turnId: "turn_1" });
    expect(after[0]?.changes).toEqual([{ path: "note.md", status: "A" }]);
  });

  it("reads only commits dated after the bound", async () => {
    const { root, run, commit } = await makeVault();
    await writeFile(nodePath.join(root, "old.md"), "long ago\n", "utf-8");
    await commit(agentCommitMessage("thr_1", "turn_old"), {
      GIT_COMMITTER_DATE: "@1000000000 +0000",
    });
    await writeFile(nodePath.join(root, "new.md"), "just now\n", "utf-8");
    await commit(agentCommitMessage("thr_1", "turn_new"));

    const commits = await readTurnCommits(run, { since: aMinuteAgo(), threadId: "thr_1" });
    expect(commits.map((turn) => turn.trailers)).toEqual([
      { kind: "turn", threadId: "thr_1", turnId: "turn_new" },
    ]);
  });

  it("ignores every other thread's commits, one whose id extends this one's included", async () => {
    const { root, run, commit } = await makeVault();
    const turns = [
      { threadId: "thr_a", turnId: "turn_1" },
      { threadId: "thr_ab", turnId: "turn_2" },
      { threadId: "thr_b", turnId: "turn_3" },
      { threadId: "thr_a", turnId: "turn_4" },
    ];
    for (const { threadId, turnId } of turns) {
      await writeFile(nodePath.join(root, `${turnId}.md`), `${threadId}\n`, "utf-8");
      await commit(agentCommitMessage(threadId, turnId));
    }
    await writeFile(nodePath.join(root, "user.md"), "a user's own commit\n", "utf-8");
    await commit("vault: update user.md\n\nThread: thr_a");

    const commits = await readTurnCommits(run, { since: aMinuteAgo(), threadId: "thr_a" });
    expect(commits.map((turn) => turn.trailers)).toEqual([
      { kind: "turn", threadId: "thr_a", turnId: "turn_1" },
      { kind: "turn", threadId: "thr_a", turnId: "turn_4" },
    ]);
  });

  it("classifies an undo by the turn it names", async () => {
    const { root, run, commit } = await makeVault();
    await writeFile(nodePath.join(root, "note.md"), "the agent's edit\n", "utf-8");
    await commit(agentCommitMessage("thr_1", "turn_1"));
    await rm(nodePath.join(root, "note.md"));
    await commit(undoCommitMessage("thr_1", "turn_1"));

    const commits = await readTurnCommits(run, { since: aMinuteAgo(), threadId: "thr_1" });
    expect(commits.map((turn) => [turn.trailers, turn.changes])).toEqual([
      [{ kind: "turn", threadId: "thr_1", turnId: "turn_1" }, [{ path: "note.md", status: "A" }]],
      [
        { kind: "undo", threadId: "thr_1", undoesTurnId: "turn_1" },
        [{ path: "note.md", status: "D" }],
      ],
    ]);
  });

  it("reports each path added, edited or deleted, a move as the path it left and the one it made", async () => {
    const { root, run, commit } = await makeVault();
    for (const name of ["edited.md", "deleted.md", "moved.md", "a.md"]) {
      await writeFile(nodePath.join(root, name), `${name}\n`, "utf-8");
    }
    await commit("vault: update 4 files");
    await writeFile(nodePath.join(root, "edited.md"), "edited\n", "utf-8");
    await rm(nodePath.join(root, "deleted.md"));
    await mkdir(nodePath.join(root, "folder"));
    await rename(nodePath.join(root, "moved.md"), nodePath.join(root, "folder", "moved.md"));
    await writeFile(nodePath.join(root, "[a].md"), "a glob would name a.md\n", "utf-8");
    await writeFile(nodePath.join(root, "odd nöte.md"), "quoted by the line format\n", "utf-8");
    await commit(agentCommitMessage("thr_1", "turn_1"));

    const [turn] = await readTurnCommits(run, { since: aMinuteAgo(), threadId: "thr_1" });
    expect(turn?.changes).toEqual([
      { path: "[a].md", status: "A" },
      { path: "deleted.md", status: "D" },
      { path: "edited.md", status: "M" },
      { path: "folder/moved.md", status: "A" },
      { path: "moved.md", status: "D" },
      { path: "odd nöte.md", status: "A" },
    ]);
  });
});
