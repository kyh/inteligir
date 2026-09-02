import { mkdir, readdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { VaultPathError, VAULT_TMP_PREFIX } from "@repo/notes/knowledge/vault-path";
import { createVaultService, sweepStaleTmpFiles, VaultServiceError } from "../vault-service";
import { createNotifierRecorder } from "./notifier-recorder";
import { identityLock } from "../../__tests__/identity-lock";
import { makeTempDir } from "../../__tests__/temp-dir";

function bootService() {
  const root = makeTempDir("inteligir-vault-test-");
  const notifier = createNotifierRecorder();
  let mutations = 0;
  const service = createVaultService({
    root,
    lock: identityLock,
    notifier,
    onMutated: () => {
      mutations += 1;
    },
  });
  return { root, notifier, service, mutationCount: () => mutations };
}

describe("what the vault is CALLED", () => {
  it("is the root's last segment, split by the side that owns the separator", async () => {
    // The client renders this verbatim. Splitting an absolute path in a
    // browser means splitting on `/` — which on Windows leaves the whole
    // path standing in for the vault's name.
    const { root, service } = bootService();
    expect((await service.listTree()).name).toBe(basename(root));
  });
});

describe("vault CRUD", () => {
  it("round-trips write → list → read → rename → delete", async () => {
    const { notifier, service, mutationCount } = bootService();

    await service.write("notes/today.md", "# Today\n");
    expect(notifier.docChanges).toEqual([
      { docId: "notes/today.md", changes: ["content-changed"] },
    ]);
    expect(notifier.vaultChanges).toEqual([["files-changed"]]);

    const tree = await service.listTree();
    expect(tree.entries).toEqual([
      { kind: "dir", path: "notes" },
      { kind: "file", modifiedMs: expect.any(Number), path: "notes/today.md" },
    ]);

    const read = await service.read("notes/today.md");
    expect(read).toEqual({ path: "notes/today.md", content: "# Today\n" });

    const renamed = await service.rename("notes/today.md", "notes/renamed.md");
    expect(renamed.path).toBe("notes/renamed.md");
    await expect(service.read("notes/today.md")).rejects.toThrow(VaultServiceError);
    expect((await service.read("notes/renamed.md")).content).toBe("# Today\n");

    await service.remove("notes/renamed.md");
    await expect(service.read("notes/renamed.md")).rejects.toThrow(VaultServiceError);
    expect(mutationCount()).toBe(3);
  });

  it("creates directories, and deletes them recursively", async () => {
    const { service } = bootService();
    await service.createDir("projects/alpha");
    await service.write("projects/alpha/plan.md", "plan");
    await service.remove("projects");
    expect((await service.listTree()).entries).toEqual([]);
  });

  it("refuses to overwrite an existing entry on rename", async () => {
    const { service } = bootService();
    await service.write("a.md", "a");
    await service.write("b.md", "b");
    await expect(service.rename("a.md", "b.md")).rejects.toMatchObject({ code: "conflict" });
  });

  it("hides .git and never serves paths into it", async () => {
    const { root, service } = bootService();
    await mkdir(join(root, ".git"), { recursive: true });
    await writeFile(join(root, ".git", "config"), "[core]\n");
    await service.write("real.md", "x");

    expect((await service.listTree()).entries).toEqual([
      { kind: "file", modifiedMs: expect.any(Number), path: "real.md" },
    ]);
    await expect(service.read(".git/config")).rejects.toThrow(VaultPathError);
    await expect(service.write(".git/hooks/pre-commit", "#!/bin/sh")).rejects.toThrow(
      VaultPathError,
    );
    await expect(service.remove(".git")).rejects.toThrow(VaultPathError);
  });

  it("refuses traversal on every mutating surface", async () => {
    const { service } = bootService();
    await expect(service.write("../escape.md", "x")).rejects.toThrow(VaultPathError);
    await expect(service.rename("../a.md", "b.md")).rejects.toThrow(VaultPathError);
    await expect(service.remove("nested/../../escape")).rejects.toThrow(VaultPathError);
    await expect(service.createDir("/abs")).rejects.toThrow(VaultPathError);
    await expect(service.writeIfUnchanged("../e.md", "a", "b")).rejects.toThrow(VaultPathError);
  });

  it("writeIfUnchanged applies only over the exact expected bytes", async () => {
    const { root, service } = bootService();
    await service.write("note.md", "original");

    const applied = await service.writeIfUnchanged("note.md", "original", "rewritten");
    expect(applied).toEqual({ applied: true, path: "note.md" });
    expect(await readFile(join(root, "note.md"), "utf8")).toBe("rewritten");

    const stale = await service.writeIfUnchanged("note.md", "original", "clobber");
    expect(stale).toEqual({ applied: false, reason: "changed" });
    expect(await readFile(join(root, "note.md"), "utf8")).toBe("rewritten");

    const missing = await service.writeIfUnchanged("ghost.md", "x", "y");
    expect(missing).toEqual({ applied: false, reason: "not_found" });
  });

  it("runs every mutation through the injected lock, serialized", async () => {
    const root = makeTempDir("inteligir-vault-test-");
    // The same promise-chain lock shape the git engine hands the runtime.
    let chain: Promise<unknown> = Promise.resolve();
    const lock = <T>(work: () => Promise<T>): Promise<T> => {
      const next = chain.then(work, work);
      chain = next.catch(() => undefined);
      return next;
    };
    const service = createVaultService({ root, notifier: createNotifierRecorder(), lock });

    // Hold the lock (a sync in flight); a write issued under it must not
    // touch disk until the holder releases.
    const holder = Promise.withResolvers<void>();
    void lock(() => holder.promise);
    const write = service.write("held.md", "waited for the lock");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    await expect(stat(join(root, "held.md"))).rejects.toThrow();

    holder.resolve();
    await write;
    expect(await readFile(join(root, "held.md"), "utf8")).toBe("waited for the lock");
  });
});

// What a SAVE costs its subscribers. Autosave runs this path per pause, so
// anything it announces is announced on that cadence to every open client.
describe("what a write announces", () => {
  it("says content-changed alone when only the bytes moved", async () => {
    const { notifier, service } = bootService();
    await service.write("note.md", "one");
    notifier.reset();

    await service.write("note.md", "two");

    expect(notifier.docChanges).toEqual([{ docId: "note.md", changes: ["content-changed"] }]);
    // `files-changed` makes every client re-walk the vault and reaches the open
    // note's reader as a SECOND event, so one save cost two reads and a walk.
    expect(notifier.vaultChanges).toEqual([]);
  });

  it("still says files-changed when the write CREATES the file", async () => {
    const { notifier, service } = bootService();
    await service.write("fresh.md", "one");
    expect(notifier.vaultChanges).toEqual([["files-changed"]]);

    notifier.reset();
    await service.writeGuarded("guarded.md", "one", { ifAbsent: true });
    expect(notifier.vaultChanges).toEqual([["files-changed"]]);
  });

  it("leaves the listing structure identical across a content edit", async () => {
    const { service } = bootService();
    await service.write("note.md", "one");
    const before = await service.listTree();
    await service.write("note.md", "a much longer body than before");
    // A content edit moves ONLY the row's mtime (the sidebar's recency reads
    // it); path/name/kind stay put, which is the tuple the vault session's
    // own same-listing check compares — so a save still re-publishes nothing
    // structural. Size stays deliberately absent: it would change on every
    // keystroke for no reader.
    const after = await service.listTree();
    expect(after.entries.map((entry) => ({ kind: entry.kind, path: entry.path }))).toEqual(
      before.entries.map((entry) => ({ kind: entry.kind, path: entry.path })),
    );
    for (const entry of after.entries) {
      if (entry.kind === "file") {
        expect(entry.modifiedMs).toEqual(expect.any(Number));
      }
    }
  });
});

describe("atomic writes and crash artifacts", () => {
  it("leaves no staging file behind after a successful write", async () => {
    const { root, service } = bootService();
    await service.write("note.md", "content");
    const names = await readdir(root);
    expect(names.filter((name) => name.startsWith(VAULT_TMP_PREFIX))).toEqual([]);
  });

  it("a crash-orphaned staging file is invisible and swept, and the write path stays clear", async () => {
    // Simulate the kill window: the tmp file landed, the rename never ran.
    const { root, service } = bootService();
    await writeFile(join(root, `${VAULT_TMP_PREFIX}deadbeef`), "half a note");

    expect((await service.listTree()).entries).toEqual([]);
    await service.write("note.md", "the real write");
    expect((await service.read("note.md")).content).toBe("the real write");

    // Cutoff a minute in the FUTURE so the orphan is unambiguously older —
    // granularity-proof, the mirror of the in-flight test below.
    await sweepStaleTmpFiles(root, Date.now() + 60_000);
    const names = await readdir(root);
    expect(names.filter((name) => name.startsWith(VAULT_TMP_PREFIX))).toEqual([]);
  });

  it("a sweep leaves an in-flight write's staging file alone", async () => {
    // It runs beside live writes now, so its bound has to be the one thing a
    // leftover can never satisfy: being older than the sweep that looks for it.
    // The cutoff sits a minute in the PAST so the fresh file is unambiguously
    // newer — a `Date.now()` captured microseconds before the write raced the
    // filesystem's mtime granularity (coarse on CI's tmpfs) and flaked.
    const { root } = bootService();
    const before = Date.now() - 60_000;
    await writeFile(join(root, `${VAULT_TMP_PREFIX}inflight`), "half a note");

    await sweepStaleTmpFiles(root, before);
    expect((await readdir(root)).filter((name) => name.startsWith(VAULT_TMP_PREFIX))).toEqual([
      `${VAULT_TMP_PREFIX}inflight`,
    ]);
  });

  it("an overwrite lands the staged content exactly, shorter than the original included", async () => {
    // What this proves: the rename swap replaces the whole entry — nothing of
    // the longer original survives. The mid-write failure window itself is
    // covered by the crash-artifact test above (tmp never visible as the note).
    const { root, service } = bootService();
    await service.write("note.md", "aaaaaaaaaa");
    await service.write("note.md", "bb");
    const content = await readFile(join(root, "note.md"), "utf8");
    expect(content).toBe("bb");
    expect((await stat(join(root, "note.md"))).size).toBe(2);
  });
});

describe("physical containment (symlinks)", () => {
  it("refuses a symlink LEAF on every surface — a pulled link must never read outside bytes", async () => {
    const { root, service } = bootService();
    const outside = makeTempDir("inteligir-outside-");
    await writeFile(join(outside, "id_ed25519"), "SECRET KEY MATERIAL");
    // Created externally, exactly as a git pull would materialize it.
    await symlink(join(outside, "id_ed25519"), join(root, "notes.md"));

    await expect(service.read("notes.md")).rejects.toThrow(VaultPathError);
    await expect(service.write("notes.md", "overwrite")).rejects.toThrow(VaultPathError);
    await expect(service.remove("notes.md")).rejects.toThrow(VaultPathError);
    await expect(service.rename("notes.md", "elsewhere.md")).rejects.toThrow(VaultPathError);
    expect(await readFile(join(outside, "id_ed25519"), "utf8")).toBe("SECRET KEY MATERIAL");
  });

  it("refuses operating THROUGH a symlinked folder — nothing lands or reads outside", async () => {
    const { root, service } = bootService();
    const outside = makeTempDir("inteligir-outside-");
    await writeFile(join(outside, "readable.txt"), "outside content");
    await symlink(outside, join(root, "evil"), "dir");

    await expect(service.write("evil/x.md", "escape")).rejects.toThrow(VaultPathError);
    await expect(service.write("evil/deep/x.md", "escape")).rejects.toThrow(VaultPathError);
    await expect(service.createDir("evil/newdir")).rejects.toThrow(VaultPathError);
    await expect(service.read("evil/readable.txt")).rejects.toThrow(VaultPathError);
    await expect(service.rename("evil/readable.txt", "stolen.md")).rejects.toThrow(VaultPathError);

    expect(await readdir(outside)).toEqual(["readable.txt"]);
    expect(await readFile(join(outside, "readable.txt"), "utf8")).toBe("outside content");
  });

  it("keeps symlinks out of the listing entirely", async () => {
    const { root, service } = bootService();
    const outside = makeTempDir("inteligir-outside-");
    await writeFile(join(outside, "secret.txt"), "s");
    await symlink(join(outside, "secret.txt"), join(root, "file-link.md"));
    await symlink(outside, join(root, "dir-link"), "dir");
    await service.write("real.md", "x");

    expect((await service.listTree()).entries).toEqual([
      { kind: "file", modifiedMs: expect.any(Number), path: "real.md" },
    ]);
  });
});
