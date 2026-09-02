// against real git: the parse frames git's own -z bytes, so a fake would only prove the fake.

import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureVaultRepo } from "../git-bootstrap";
import { runGit } from "../git-run";
import { parseFollowLog, readNoteHistory, readNoteRevision } from "../git-history";
import { VaultServiceError } from "../vault-service";
import { hermeticGitEnv } from "./git-test-env";
import { makeTempDir } from "../../__tests__/temp-dir";

const env = hermeticGitEnv();

async function makeVault(): Promise<{
  root: string;
  run: (args: readonly string[]) => Promise<{ stdout: string }>;
  commit: (subject: string) => Promise<void>;
}> {
  const root = makeTempDir("inteligir-history-");
  await ensureVaultRepo({ root, env });
  const run = (args: readonly string[], options?: { env?: Record<string, string> }) =>
    runGit(root, args, { env: { ...env, ...options?.env } });
  return {
    root,
    run,
    commit: async (subject) => {
      await run(["add", "-A"]);
      await run(["-c", "commit.gpgsign=false", "commit", "-m", subject], {
        env: {
          GIT_AUTHOR_NAME: "A",
          GIT_AUTHOR_EMAIL: "a@b.c",
          GIT_COMMITTER_NAME: "A",
          GIT_COMMITTER_EMAIL: "a@b.c",
        },
      });
    },
  };
}

describe("parseFollowLog", () => {
  it("frames a commit with no name-status block against the newer row's path", () => {
    const stdout = ["abc".repeat(13) + "d", "2026-01-01T00:00:00+00:00", "A", "a@b.c", "s"].join(
      "\0",
    );
    expect(parseFollowLog(stdout, "Note.md")).toEqual([
      {
        sha: "abc".repeat(13) + "d",
        authoredAt: "2026-01-01T00:00:00+00:00",
        authorName: "A",
        authorEmail: "a@b.c",
        subject: "s",
        path: "Note.md",
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
    await writeFile(join(root, "a note.md"), "one\n", "utf8");
    await commit("vault: update a note.md");
    await rename(join(root, "a note.md"), join(root, "ünïcode nöte.md"));
    await commit("vault: rename");
    await writeFile(join(root, "ünïcode nöte.md"), "one\ntwo\n", "utf8");
    await commit("vault: update ünïcode nöte.md");

    const revisions = await readNoteHistory(run, "ünïcode nöte.md", { skip: 0, limit: 50 });
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
      await writeFile(join(root, "Note.md"), `line ${String(index)}\n`, "utf8");
      await commit(`vault: update ${String(index)}`);
    }
    const page = await readNoteHistory(run, "Note.md", { skip: 1, limit: 1 });
    expect(page.map((revision) => revision.subject)).toEqual(["vault: update 2"]);
  });

  it("frames a commit that reports MORE THAN ONE status for the followed path", async () => {
    // a note that became a folder and a note again reports two statuses in one commit.
    const { root, run, commit } = await makeVault();
    await writeFile(join(root, "Note.md"), "one\n", "utf8");
    await commit("vault: first");
    await rm(join(root, "Note.md"));
    await mkdir(join(root, "Note.md"), { recursive: true });
    await writeFile(join(root, "Note.md", "child"), "child\n", "utf8");
    await commit("vault: folder");
    await rm(join(root, "Note.md"), { recursive: true });
    await writeFile(join(root, "Note.md"), "three\n", "utf8");
    await commit("vault: file again");

    const revisions = await readNoteHistory(run, "Note.md", { skip: 0, limit: 50 });
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
    await writeFile(join(root, "a.md"), "plain\n", "utf8");
    await writeFile(join(root, "[a].md"), "bracketed\n", "utf8");
    await commit("vault: both");
    await writeFile(join(root, "a.md"), "plain edited\n", "utf8");
    await commit("vault: only a.md");

    const revisions = await readNoteHistory(run, "[a].md", { skip: 0, limit: 50 });
    expect(revisions.map((revision) => revision.subject)).toEqual(["vault: both"]);
  });

  it("drops a revision that only DELETED the note — every row it lists is readable", async () => {
    const { root, run, commit } = await makeVault();
    await writeFile(join(root, "Note.md"), "one\n", "utf8");
    await commit("vault: create");
    await rm(join(root, "Note.md"));
    await commit("vault: delete");
    await writeFile(join(root, "Note.md"), "again\n", "utf8");
    await commit("vault: recreate");

    const revisions = await readNoteHistory(run, "Note.md", { skip: 0, limit: 50 });
    expect(revisions.map((revision) => revision.subject)).not.toContain("vault: delete");
    for (const revision of revisions) {
      await expect(readNoteRevision(run, revision.path, revision.sha)).resolves.toEqual(
        expect.any(String),
      );
    }
  });

  it("answers an empty page for a path git has never seen", async () => {
    const { run } = await makeVault();
    expect(await readNoteHistory(run, "Never.md", { skip: 0, limit: 50 })).toEqual([]);
  });
});

describe("readNoteRevision", () => {
  it("reads the bytes a note held at its own historical path", async () => {
    const { root, run, commit } = await makeVault();
    await writeFile(join(root, "Old.md"), "before\n", "utf8");
    await commit("vault: update Old.md");
    // the rename is its own commit: git detects renames by similarity, so one that also rewrites the body is a delete plus an add.
    await rename(join(root, "Old.md"), join(root, "New.md"));
    await commit("vault: rename Old.md");
    await writeFile(join(root, "New.md"), "after\n", "utf8");
    await commit("vault: update New.md");

    const revisions = await readNoteHistory(run, "New.md", { skip: 0, limit: 50 });
    const oldest = revisions.at(-1);
    expect(oldest?.path).toBe("Old.md");
    expect(await readNoteRevision(run, oldest?.path ?? "", oldest?.sha ?? "")).toBe("before\n");
  });

  it("refuses not_found for a path absent at that revision", async () => {
    const { root, run, commit } = await makeVault();
    await writeFile(join(root, "Note.md"), "x\n", "utf8");
    await commit("vault: update Note.md");
    const [head] = await readNoteHistory(run, "Note.md", { skip: 0, limit: 1 });
    await expect(readNoteRevision(run, "Missing.md", head?.sha ?? "")).rejects.toThrow(
      VaultServiceError,
    );
  });

  it("refuses not_found when the path names a folder at that revision", async () => {
    const { root, run, commit } = await makeVault();
    await mkdir(join(root, "notes"), { recursive: true });
    await writeFile(join(root, "notes", "Note.md"), "x\n", "utf8");
    await commit("vault: update notes/Note.md");
    const [head] = await readNoteHistory(run, "notes/Note.md", { skip: 0, limit: 1 });
    // a folder is a legal vault path: the object exists at that revision and is a tree.
    await expect(readNoteRevision(run, "notes", head?.sha ?? "")).rejects.toThrow(
      VaultServiceError,
    );
  });
});
