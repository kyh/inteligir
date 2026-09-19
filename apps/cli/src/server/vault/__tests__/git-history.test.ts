// against real git: the parse frames git's own -z bytes, so a fake would only prove the fake.

import { existsSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import nodePath from "node:path";
import { describe, expect, it } from "vitest";
import { ensureVaultRepo } from "../git-bootstrap";
import { runGit } from "../git-run";
import {
  parseDeletionLog,
  parseFollowLog,
  readDeletedNotes,
  readNoteHistory,
  readNoteRevision,
} from "../git-history";
import { VaultServiceError } from "../vault-service";
import { hermeticGitEnv } from "./git-test-env";
import { makeTempDir } from "../../__tests__/temp-dir";

// vitest types its asymmetric matchers `any`; naming one keeps the assertion typed.
const anIsoTimestamp: unknown = expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/u);

const env = hermeticGitEnv();

const makeVault = async (): Promise<{
  root: string;
  run: (args: readonly string[]) => Promise<{ stdout: string }>;
  commit: (subject: string) => Promise<void>;
}> => {
  const root = makeTempDir("inteligir-history-");
  await ensureVaultRepo({ env, root });
  const run = async (args: readonly string[], options?: { env?: Record<string, string> }) =>
    await runGit(root, args, { env: { ...env, ...options?.env } });
  return {
    commit: async (subject) => {
      await run(["add", "-A"]);
      await run(["-c", "commit.gpgsign=false", "commit", "-m", subject], {
        env: {
          GIT_AUTHOR_EMAIL: "a@b.c",
          GIT_AUTHOR_NAME: "A",
          GIT_COMMITTER_EMAIL: "a@b.c",
          GIT_COMMITTER_NAME: "A",
        },
      });
    },
    root,
    run,
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

    const entries = await readDeletedNotes(run, onDisk(root));
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

    const entries = await readDeletedNotes(run, onDisk(root));
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

    const entries = await readDeletedNotes(run, onDisk(root));
    expect(entries.map((entry) => entry.path)).toEqual(["Twice.md"]);
    expect(await readNoteRevision(run, "Twice.md", entries[0]?.sha ?? "")).toBe("second\n");
  });

  it("does not report a rename as a deletion", async () => {
    const { root, run, commit } = await makeVault();
    await writeFile(nodePath.join(root, "Old.md"), "same bytes\n", "utf-8");
    await commit("vault: create");
    await rename(nodePath.join(root, "Old.md"), nodePath.join(root, "New.md"));
    await commit("vault: rename");

    expect(await readDeletedNotes(run, onDisk(root))).toEqual([]);
  });
});
