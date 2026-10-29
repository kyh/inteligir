import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { VAULT_MAX_CONTENT_LENGTH } from "@repo/contract/local/vault/vault-schema";
import type {
  VaultStatusResponse,
  VaultSyncConflict,
} from "@repo/contract/local/vault/vault-schema";
import {
  annotationsStorePath,
  parseAnnotationStore,
  serializeAnnotationStore,
} from "@repo/notes/annotations/store-schema";
import type { AnnotationEntry } from "@repo/notes/annotations/store-schema";
import { removeFrontmatterId } from "@repo/notes/markdown/frontmatter";
import { describeSyncConflict } from "@repo/notes/sync/conflict-copy";
import { reconcileFile } from "@repo/notes/sync/reconcile-file";
import type { ReconcileInput } from "@repo/notes/sync/reconcile-file";
import { describe, expect, it } from "vitest";
import { mergeFetched } from "./git-merge";
import type { Reconcile } from "./git-merge";
import {
  asDevice,
  conflictCopies,
  expectCleanRepo,
  git,
  gitDirPath,
  lastMessage,
  makeBareRemote,
  makeEngine,
  makeWorktreeVault,
  markingHook,
  refusingHook,
  scratchDir,
  seedMarker,
  syncState,
  tipOf,
  trackedFiles,
} from "./test-support/git-fixtures";

const DEVICE_A = "Device A";

const DEVICE_B = "Device B";

// a note both devices hold, carrying an id a copy must not keep
const SHARED_BASE = "---\nid: 3f0c9a52-shared\n---\n\n# Shared\n\nthe line both edit\n";

const SHARED_A = SHARED_BASE.replace("the line both edit", "edited on A");

const SHARED_B = SHARED_BASE.replace("the line both edit", "edited on B");

const COPY_OF_A = "shared (conflict, Device A).md";

type Side = Awaited<ReturnType<typeof makeEngine>>;

const commitFile = async (side: Side, relPath: string, content: string | Uint8Array) => {
  const file = path.join(side.root, relPath);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
  await side.engine.commitNow();
};

const commitRemoval = async (side: Side, relPath: string) => {
  await rm(path.join(side.root, relPath));
  await side.engine.commitNow();
};

// how B differs: where its vault sits, and the verdict it merges with
type SideOptions = Pick<Parameters<typeof makeEngine>[0], "root" | "reconcile">;

// A on `Device A` and B on `Device B`, one remote, both holding `shared.md` at its base
const sharedPair = async (bOptions: SideOptions = {}) => {
  const remote = await makeBareRemote();
  const a = await makeEngine({ device: DEVICE_A, remoteUrl: remote });
  const b = await makeEngine({ ...bOptions, device: DEVICE_B, remoteUrl: remote });
  await commitFile(a, "shared.md", SHARED_BASE);
  expect(await syncState(a.engine)).toBe("clean");
  expect(await syncState(b.engine)).toBe("clean");
  expect(await syncState(a.engine)).toBe("clean");
  return { a, b, remote };
};

// A pushes its edit of the shared line; B commits its own, which B's next pass meets.
const divergedPair = async (options: SideOptions = {}) => {
  const pair = await sharedPair(options);
  await commitFile(pair.a, "shared.md", SHARED_A);
  expect(await syncState(pair.a.engine)).toBe("clean");
  await commitFile(pair.b, "shared.md", SHARED_B);
  return pair;
};

const readVault = async (side: Side, relPath: string): Promise<string> =>
  await readFile(path.join(side.root, relPath), "utf-8");

const treeOf = async (root: string): Promise<string> => {
  const { stdout } = await git.run(root, ["rev-parse", "HEAD^{tree}"]);
  return stdout.trim();
};

const mergeHeadLeft = async (root: string): Promise<boolean> => {
  try {
    await git.run(root, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]);
    return true;
  } catch {
    return false;
  }
};

const parentCount = async (root: string, rev: string): Promise<number> => {
  const { stdout } = await git.run(root, ["rev-list", "--parents", "-n", "1", rev]);
  return stdout.trim().split(" ").length - 1;
};

const rootCommitOf = async (root: string): Promise<string> => {
  const { stdout } = await git.run(root, ["rev-list", "--max-parents=0", "HEAD"]);
  return stdout.trim();
};

// bytes no UTF-8 decoder reads as text
const photoBytes = (fill: number): Uint8Array =>
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, fill, 0x00]);

const onlyConflict = (status: VaultStatusResponse): VaultSyncConflict => {
  const [report, ...rest] = status.conflicts;
  if (report === undefined || rest.length > 0) {
    throw new Error(`expected one conflict, got ${JSON.stringify(status.conflicts)}`);
  }
  return report;
};

// a person's own git in the vault, whose refusal to finish is the point
const leaveStopped = async (root: string, gitArgs: readonly string[]): Promise<void> => {
  await git.run(root, ["fetch", "-q", "origin"]);
  await expect(git.run(root, gitArgs, asDevice(DEVICE_B))).rejects.toThrow();
};

// a verdict that throws on the note both devices edit, so a merge of it fails outright
const failsOnShared: Reconcile = (input) => {
  if (input.path === "shared.md") {
    throw new Error("injected reconcile failure");
  }
  return reconcileFile(input);
};

// the same note edited on two devices between syncs: every pass ends pushed, and a path whose two
// versions cannot both stay keeps this device's and copies the other's aside.
describe("a pass that meets another device's edit", { timeout: 30_000 }, () => {
  it("keeps its own line, copies the other's aside without its id, pushes, and converges", async () => {
    const { a, b } = await divergedPair();
    const merged = await b.engine.syncNow();
    expect(merged.state).toBe("clean");
    expect(merged.lastError).toBeNull();
    expect(merged.device).toBe(DEVICE_B);
    expect(await readVault(b, "shared.md")).toBe(SHARED_B);
    expect(await readVault(b, COPY_OF_A)).toBe(removeFrontmatterId(SHARED_A));
    expect(await readVault(b, COPY_OF_A)).not.toContain("id:");
    expect(onlyConflict(merged)).toEqual({
      at: expect.any(Number),
      copyDevice: DEVICE_A,
      copyPath: COPY_OF_A,
      keptDevice: DEVICE_B,
      kind: "copied",
      path: "shared.md",
    });
    expect(await lastMessage(b.root)).toBe("vault: merge 1 note from Device A");
    expect(await parentCount(b.root, "HEAD")).toBe(2);
    await expectCleanRepo(b.root);

    expect(await syncState(a.engine)).toBe("clean");
    expect(await treeOf(a.root)).toBe(await treeOf(b.root));
    expect(await readVault(a, "shared.md")).toBe(SHARED_B);
    const pulled = onlyConflict(await a.engine.status());
    expect(pulled).toMatchObject({
      copyDevice: DEVICE_A,
      copyPath: COPY_OF_A,
      keptDevice: DEVICE_B,
      kind: "copied",
      path: "shared.md",
    });
    expect(describeSyncConflict(pulled, { thisDevice: DEVICE_A })).toBe(
      "Both versions of “shared” were kept: the one from Device B stays, and yours is in “shared (conflict, Device A)”.",
    );
  });

  it("keeps an edit over the other device's deletion, whichever side deleted", async () => {
    const deletedThere = await sharedPair();
    await commitRemoval(deletedThere.a, "shared.md");
    expect(await syncState(deletedThere.a.engine)).toBe("clean");
    await commitFile(deletedThere.b, "shared.md", SHARED_B);
    const keptHere = await deletedThere.b.engine.syncNow();
    expect(keptHere.state).toBe("clean");
    expect(await readVault(deletedThere.b, "shared.md")).toBe(SHARED_B);
    expect(onlyConflict(keptHere)).toMatchObject({
      deletedDevice: DEVICE_A,
      keptDevice: DEVICE_B,
      kind: "kept-edit",
      path: "shared.md",
    });

    const deletedHere = await sharedPair();
    await commitFile(deletedHere.a, "shared.md", SHARED_A);
    expect(await syncState(deletedHere.a.engine)).toBe("clean");
    await commitRemoval(deletedHere.b, "shared.md");
    const keptThere = await deletedHere.b.engine.syncNow();
    expect(keptThere.state).toBe("clean");
    expect(await readVault(deletedHere.b, "shared.md")).toBe(SHARED_A);
    expect(onlyConflict(keptThere)).toMatchObject({
      deletedDevice: DEVICE_B,
      keptDevice: DEVICE_A,
      kind: "kept-edit",
      path: "shared.md",
    });
    for (const { b } of [deletedThere, deletedHere]) {
      expect(await conflictCopies(b.root)).toEqual([]);
      await expectCleanRepo(b.root);
    }
  });

  it("merges two unrelated histories on the first pass, copying only what the two hold differently", async () => {
    const remote = await makeBareRemote();
    const a = await makeEngine({ device: DEVICE_A, remoteUrl: remote });
    await commitFile(a, "same.md", "the same on both\n");
    await commitFile(a, "differs.md", "A's version\n");
    await commitFile(a, "only-a.md", "A alone\n");
    expect(await syncState(a.engine)).toBe("clean");

    const b = await makeEngine({ device: DEVICE_B, remoteUrl: remote });
    await commitFile(b, "same.md", "the same on both\n");
    await commitFile(b, "differs.md", "B's version\n");
    await commitFile(b, "only-b.md", "B alone\n");
    expect(await rootCommitOf(b.root)).not.toBe(await rootCommitOf(a.root));

    const merged = await b.engine.syncNow();
    expect(merged.state).toBe("clean");
    expect(await trackedFiles(b.root)).toEqual([
      "differs (conflict, Device A).md",
      "differs.md",
      "only-a.md",
      "only-b.md",
      "same.md",
    ]);
    expect(await readVault(b, "differs.md")).toBe("B's version\n");
    expect(await readVault(b, "differs (conflict, Device A).md")).toBe("A's version\n");
    expect(onlyConflict(merged)).toMatchObject({
      copyPath: "differs (conflict, Device A).md",
      kind: "copied",
      path: "differs.md",
    });
    await expectCleanRepo(b.root);
  });

  it("reports none of the copies a remote already held when an unrelated history joins it", async () => {
    const remote = await makeBareRemote();
    const a = await makeEngine({ device: DEVICE_A, remoteUrl: remote });
    await commitFile(a, "Foo.md", "the version that stayed\n");
    await commitFile(a, "Foo (conflict, Device A).md", "set aside long ago\n");
    expect(await syncState(a.engine)).toBe("clean");

    const b = await makeEngine({ device: DEVICE_B, remoteUrl: remote });
    await commitFile(b, "only-b.md", "B alone\n");
    expect(await rootCommitOf(b.root)).not.toBe(await rootCommitOf(a.root));

    const joined = await b.engine.syncNow();
    expect(joined.state).toBe("clean");
    expect(await trackedFiles(b.root)).toContain("Foo (conflict, Device A).md");
    expect(joined.conflicts).toEqual([]);
  });

  it("settles a version past the read cap by its blob, never reading it", async () => {
    const { b } = await divergedPair();
    await git.run(b.root, ["fetch", "-q", "origin", "main"]);
    const asked: ReconcileInput[] = [];
    const reports = await mergeFetched(
      {
        readBlob: async () => await Promise.reject(new Error("read a blob past the cap")),
        run: async (gitArgs, options) =>
          gitArgs[0] === "cat-file" && gitArgs[1] === "-s"
            ? { stdout: `${String(VAULT_MAX_CONTENT_LENGTH + 1)}\n` }
            : await git.run(b.root, gitArgs, options),
      },
      {
        device: DEVICE_B,
        reconcile: (input) => {
          asked.push(input);
          return reconcileFile(input);
        },
        remoteRef: "refs/remotes/origin/main",
      },
    );

    expect(asked.flatMap(({ base, mine, theirs }) => [base.kind, mine.kind, theirs.kind])).toEqual([
      "opaque",
      "opaque",
      "opaque",
    ]);
    expect(reports).toEqual([
      {
        copyDevice: DEVICE_A,
        copyPath: COPY_OF_A,
        keptDevice: DEVICE_B,
        kind: "copied",
        path: "shared.md",
      },
    ]);
    expect(await readVault(b, "shared.md")).toBe(SHARED_B);
    expect(await readVault(b, COPY_OF_A)).toBe(SHARED_A);
    await expectCleanRepo(b.root);
  });

  it("unions two devices' annotations on one note, and copies nothing", async () => {
    const store = annotationsStorePath("3f0c9a52-shared");
    const at = 1_707_900_000;
    const entry = (text: string): AnnotationEntry => ({
      createdAt: at,
      source: "user",
      text,
      updatedAt: at,
    });
    const { a, b } = await sharedPair();
    await commitFile(a, store, serializeAnnotationStore({ c1: entry("Why Friday?") }));
    expect(await syncState(a.engine)).toBe("clean");
    expect(await syncState(b.engine)).toBe("clean");

    await commitFile(
      a,
      store,
      serializeAnnotationStore({ a1: entry("from A"), c1: entry("Why Friday?") }),
    );
    expect(await syncState(a.engine)).toBe("clean");
    await commitFile(
      b,
      store,
      serializeAnnotationStore({ b1: entry("from B"), c1: entry("Why Friday?") }),
    );

    const merged = await b.engine.syncNow();
    expect(merged.state).toBe("clean");
    expect(merged.conflicts).toEqual([]);
    expect(await conflictCopies(b.root)).toEqual([]);
    const parsed = parseAnnotationStore(await readVault(b, store));
    expect(parsed.ok ? Object.keys(parsed.store).toSorted() : parsed.error).toEqual([
      "a1",
      "b1",
      "c1",
    ]);
    await expectCleanRepo(b.root);
  });

  it("copies aside the other device's version of a file that is not text, blob for blob", async () => {
    const photo = "photo.png";
    const copy = "photo (conflict, Device A).png";
    const { a, b } = await sharedPair();
    await commitFile(a, photo, photoBytes(1));
    expect(await syncState(a.engine)).toBe("clean");
    expect(await syncState(b.engine)).toBe("clean");
    await commitFile(a, photo, photoBytes(2));
    expect(await syncState(a.engine)).toBe("clean");
    await commitFile(b, photo, photoBytes(3));

    const merged = await b.engine.syncNow();
    expect(merged.state).toBe("clean");
    expect(await tipOf(b.root, `HEAD:${copy}`)).toBe(await tipOf(a.root, `HEAD:${photo}`));
    expect(new Uint8Array(await readFile(path.join(b.root, photo)))).toEqual(photoBytes(3));
    expect(new Uint8Array(await readFile(path.join(b.root, copy)))).toEqual(photoBytes(2));
    expect(onlyConflict(merged)).toMatchObject({ copyPath: copy, kind: "copied", path: photo });
  });

  it("merges again, never rebases, while its own merge waits unpushed", async () => {
    const { a, b, remote } = await divergedPair();
    const refusal = path.join(remote, "hooks", "pre-receive");
    await refusingHook(path.dirname(refusal), "pre-receive");
    expect(await syncState(b.engine)).toBe("rejected");
    const unpushed = await tipOf(b.root, "HEAD");
    expect(await parentCount(b.root, unpushed)).toBe(2);
    await rm(refusal);

    await commitFile(a, "other.md", "more from A\n");
    expect(await syncState(a.engine)).toBe("clean");

    expect(await syncState(b.engine)).toBe("clean");
    await git.run(b.root, ["merge-base", "--is-ancestor", unpushed, "HEAD"]);
    expect(await parentCount(b.root, "HEAD")).toBe(2);
    expect(await readVault(b, "shared.md")).toBe(SHARED_B);
    expect(await readVault(b, COPY_OF_A)).toBe(removeFrontmatterId(SHARED_A));
    expect(await readVault(b, "other.md")).toBe("more from A\n");
    await expectCleanRepo(b.root);
  });

  it("aborts a merge that fails half-way, says so plainly, and tries again only once a side moves", async () => {
    let failing = true;
    const asked: string[] = [];
    // the paths settle in order, so `first.md` lands, with its copy, before `shared.md` throws
    const reconcile: Reconcile = (input) => {
      asked.push(input.path);
      if (failing && input.path === "shared.md") {
        throw new Error("injected reconcile failure");
      }
      return reconcileFile(input);
    };
    const { a, b } = await sharedPair({ reconcile });
    await commitFile(a, "first.md", "the line both edit\n");
    expect(await syncState(a.engine)).toBe("clean");
    expect(await syncState(b.engine)).toBe("clean");
    await commitFile(a, "first.md", "edited on A\n");
    await commitFile(a, "shared.md", SHARED_A);
    expect(await syncState(a.engine)).toBe("clean");
    await commitFile(b, "first.md", "edited on B\n");
    await commitFile(b, "shared.md", SHARED_B);

    // not dirty: that reads as edits on their way, and says nothing of the failure
    const failed = await b.engine.syncNow();
    expect(failed.state).toBe("stalled");
    expect(failed.lastError).toMatch(/could not be combined/u);
    expect(failed.lastError).not.toMatch(/git|merge|commit|injected/iu);
    expect(failed.conflicts).toEqual([]);
    expect(asked).toEqual(["first.md", "shared.md"]);
    expect(await mergeHeadLeft(b.root)).toBe(false);
    expect(existsSync(path.join(b.root, "first (conflict, Device A).md"))).toBe(false);
    await expectCleanRepo(b.root);
    expect(await readVault(b, "first.md")).toBe("edited on B\n");
    expect(await readVault(b, "shared.md")).toBe(SHARED_B);

    expect(await syncState(b.engine)).toBe("stalled");
    expect(asked).toHaveLength(2);

    failing = false;
    await commitFile(a, "other.md", "more from A\n");
    expect(await syncState(a.engine)).toBe("clean");
    expect(await syncState(b.engine)).toBe("clean");
    expect(asked).toHaveLength(4);
    expect(await readVault(b, "first (conflict, Device A).md")).toBe("edited on A\n");
    expect(await readVault(b, COPY_OF_A)).toBe(removeFrontmatterId(SHARED_A));
  });

  it("says why it stalled again when a pass that went offline in between meets the same tips", async () => {
    const { b, remote } = await divergedPair({ reconcile: failsOnShared });
    const failed = await b.engine.syncNow();
    expect(failed.state).toBe("stalled");
    expect(failed.lastError).toMatch(/could not be combined/u);

    const away = `${remote}-away`;
    await rename(remote, away);
    const offline = await b.engine.syncNow();
    expect(offline.state).toBe("offline");
    expect(offline.lastError).not.toBe(failed.lastError);
    await rename(away, remote);

    expect(await b.engine.syncNow()).toMatchObject({
      lastError: failed.lastError,
      state: "stalled",
    });
  });

  it("clears a merge a crash left behind before its first commit", async () => {
    const { b } = await divergedPair();
    await leaveStopped(b.root, ["merge", "--no-commit", "refs/remotes/origin/main"]);
    expect(await mergeHeadLeft(b.root)).toBe(true);

    const restarted = await makeEngine({ device: DEVICE_B, remoteUrl: null, root: b.root });
    await commitFile(restarted, "after-crash.md", "written after the crash\n");
    expect(await mergeHeadLeft(b.root)).toBe(false);
    expect(await parentCount(b.root, "HEAD")).toBe(1);
    expect(await lastMessage(b.root)).toBe("vault: update after-crash.md");
    expect(await readVault(b, "shared.md")).toBe(SHARED_B);
    await expectCleanRepo(b.root);
  });

  it("clears a rebase a crash left behind before its first commit", async () => {
    const { b } = await divergedPair();
    await leaveStopped(b.root, ["rebase", "refs/remotes/origin/main"]);
    const rebaseDir = await gitDirPath(b.root, "rebase-merge");
    expect(existsSync(rebaseDir)).toBe(true);

    const restarted = await makeEngine({ device: DEVICE_B, remoteUrl: null, root: b.root });
    await commitFile(restarted, "after-crash.md", "written after the crash\n");
    expect(existsSync(rebaseDir)).toBe(false);
    const branch = await git.run(b.root, ["symbolic-ref", "--short", "HEAD"]);
    expect(branch.stdout.trim()).toBe("main");
    expect(await lastMessage(b.root)).toBe("vault: update after-crash.md");
    expect(await readVault(b, "shared.md")).toBe(SHARED_B);
    await expectCleanRepo(b.root);
  });

  it("lands its verdict where the vault's own rerere recorded another resolution", async () => {
    const { b } = await divergedPair();
    await git.run(b.root, ["config", "rerere.enabled", "true"]);
    // the person's own git records it; runGit turns rerere off for every call that names it not
    const rerere = ["-c", "rerere.enabled=true"];
    await leaveStopped(b.root, [...rerere, "merge", "refs/remotes/origin/main"]);
    await writeFile(path.join(b.root, "shared.md"), "what rerere recorded\n", "utf-8");
    await git.run(b.root, ["add", "shared.md"], asDevice(DEVICE_B));
    await git.run(b.root, [...rerere, "commit", "-q", "--no-edit"], asDevice(DEVICE_B));
    await git.run(b.root, ["reset", "-q", "--hard", "HEAD~1"], asDevice(DEVICE_B));
    expect(existsSync(await gitDirPath(b.root, "rr-cache"))).toBe(true);

    expect(await syncState(b.engine)).toBe("clean");
    expect(await readVault(b, "shared.md")).toBe(SHARED_B);
    expect(await readVault(b, COPY_OF_A)).toBe(removeFrontmatterId(SHARED_A));
  });

  it("runs none of the vault's own hooks through a merge", async () => {
    const { b } = await divergedPair();
    const markers = scratchDir("inteligir-git-merge-hook-markers-");
    const hookNames = [
      "pre-merge-commit",
      "prepare-commit-msg",
      "commit-msg",
      "post-merge",
      "post-commit",
      "post-checkout",
      "reference-transaction",
    ];
    for (const name of hookNames) {
      await markingHook(path.join(b.root, ".git", "hooks"), name, path.join(markers, name));
    }
    expect(await syncState(b.engine)).toBe("clean");
    expect(await readVault(b, COPY_OF_A)).toBe(removeFrontmatterId(SHARED_A));
    for (const name of hookNames) {
      expect(existsSync(path.join(markers, name))).toBe(false);
    }
  });

  it("names this device as the committer of every commit it makes", async () => {
    const { a, b } = await divergedPair();
    expect(await syncState(b.engine)).toBe("clean");
    expect(await syncState(a.engine)).toBe("clean");
    const { stdout } = await git.run(a.root, ["log", "--format=%cn%x09%s"]);
    const rows = stdout
      .trim()
      .split("\n")
      .map((row) => row.split("\t"));
    for (const [committer] of rows) {
      expect([DEVICE_A, DEVICE_B]).toContain(committer);
    }
    expect(rows).toContainEqual([DEVICE_B, "vault: merge 1 note from Device A"]);
    expect(rows).toContainEqual([DEVICE_B, "vault: update shared.md"]);
    expect(rows).toContainEqual([DEVICE_A, "vault: update shared.md"]);
  });

  it("merges in a linked-worktree vault instead of calling the repo broken", async () => {
    const { b } = await divergedPair({ root: await makeWorktreeVault() });
    expect(await syncState(b.engine)).toBe("clean");
    expect(await readVault(b, "shared.md")).toBe(SHARED_B);
    expect(await readVault(b, COPY_OF_A)).toBe(removeFrontmatterId(SHARED_A));
    await expectCleanRepo(b.root);
  });
});

const STARTER_WELCOME = "# Welcome\n\nThe note every new vault starts with.\n";

const WELCOME_ON_A = "# Welcome\n\nRewritten on A.\n";

const seedStarters = async (dir: string): Promise<void> => {
  await writeFile(path.join(dir, "Welcome.md"), STARTER_WELCOME, "utf-8");
  await writeFile(path.join(dir, "Tour.md"), "# Tour\n\nA second starter.\n", "utf-8");
};

// A seeded, rewrote one starter, deleted the other, wrote a note of its own and pushed it all.
const accountWithHistory = async () => {
  const remote = await makeBareRemote();
  const a = await makeEngine({ device: DEVICE_A, remoteUrl: remote, seed: seedStarters });
  await commitFile(a, "Welcome.md", WELCOME_ON_A);
  await commitRemoval(a, "Tour.md");
  await commitFile(a, "only-on-a.md", "# Only on A\n");
  expect(await syncState(a.engine)).toBe("clean");
  return { a, remote };
};

describe("a starter vault meeting a remote with history", { timeout: 30_000 }, () => {
  it("records the commit it seeded, and only for a folder it seeded", async () => {
    const seeded = await makeEngine({ remoteUrl: null, seed: seedStarters });
    expect(await seedMarker(seeded.root)).toBe(await tipOf(seeded.root, "HEAD"));
    expect(await trackedFiles(seeded.root)).toEqual(["Tour.md", "Welcome.md"]);

    const opened = await makeEngine({ remoteUrl: null });
    expect(await seedMarker(opened.root)).toBeNull();
  });

  it("takes the remote's history whole: no starter kept over it, copied aside or brought back", async () => {
    const { a, remote } = await accountWithHistory();
    const b = await makeEngine({ device: DEVICE_B, remoteUrl: remote, seed: seedStarters });

    const status = await b.engine.syncNow();
    expect(status.state).toBe("clean");
    expect(status.conflicts).toEqual([]);
    expect(await tipOf(b.root, "HEAD")).toBe(await tipOf(a.root, "HEAD"));
    expect(await treeOf(b.root)).toBe(await treeOf(a.root));
    expect(await conflictCopies(b.root)).toEqual([]);
    expect(await readVault(b, "Welcome.md")).toBe(WELCOME_ON_A);
    expect(existsSync(path.join(b.root, "Tour.md"))).toBe(false);
    expect(await seedMarker(b.root)).toBeNull();
    expect(b.filesChanges()).toEqual([
      { kind: "paths", paths: ["Tour.md", "Welcome.md", "only-on-a.md"] },
    ]);
    expect(b.notices()).toHaveLength(1);
    await expectCleanRepo(b.root);

    const aHead = await tipOf(a.root, "HEAD");
    expect(await syncState(a.engine)).toBe("clean");
    expect(await tipOf(a.root, "HEAD")).toBe(aHead);
    expect(await syncState(b.engine)).toBe("clean");
    expect(b.notices()).toHaveLength(1);
  });

  it("merges as ever once anything was written here, and keeps what was written", async () => {
    const { remote } = await accountWithHistory();
    const b = await makeEngine({ device: DEVICE_B, remoteUrl: remote, seed: seedStarters });
    await commitFile(b, "Welcome.md", "# Welcome\n\nRewritten on B.\n");

    expect(await syncState(b.engine)).toBe("clean");
    expect(await readVault(b, "Welcome.md")).toBe("# Welcome\n\nRewritten on B.\n");
    expect(await readVault(b, "Welcome (conflict, Device A).md")).toBe(WELCOME_ON_A);
    expect(await readVault(b, "only-on-a.md")).toBe("# Only on A\n");
    expect(await seedMarker(b.root)).toBeNull();
    expect(b.notices()).toEqual([]);
  });

  it("never takes over a folder it did not seed, whatever it holds", async () => {
    const { remote } = await accountWithHistory();
    const root = scratchDir("inteligir-git-opened-");
    await writeFile(path.join(root, "Welcome.md"), STARTER_WELCOME, "utf-8");
    const b = await makeEngine({ device: DEVICE_B, remoteUrl: remote, root });

    expect(await syncState(b.engine)).toBe("clean");
    expect(await readVault(b, "Welcome.md")).toBe(STARTER_WELCOME);
    expect(await conflictCopies(b.root)).toEqual(["Welcome (conflict, Device A).md"]);
    expect(b.notices()).toEqual([]);
  });

  it("keeps the seed's claim across a restart", async () => {
    const { a, remote } = await accountWithHistory();
    const root = path.join(scratchDir("inteligir-git-restarted-"), "vault");
    const before = await makeEngine({
      device: DEVICE_B,
      remoteUrl: null,
      root,
      seed: seedStarters,
    });
    const seed = await tipOf(root, "HEAD");
    await before.engine.dispose();

    const after = await makeEngine({
      device: DEVICE_B,
      remoteUrl: remote,
      root,
      seed: seedStarters,
    });
    expect(await seedMarker(root)).toBe(seed);
    expect(await syncState(after.engine)).toBe("clean");
    expect(await treeOf(root)).toBe(await treeOf(a.root));
    expect(await seedMarker(root)).toBeNull();
  });
});
