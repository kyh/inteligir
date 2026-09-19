import { mkdir, readdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { VaultPathError, VAULT_TMP_PREFIX } from "@repo/notes/knowledge/vault-path";
import { createVaultService, sweepStaleTmpFiles, VaultServiceError } from "../vault-service";
import { createNotifierRecorder } from "./notifier-recorder";
import { identityLock } from "../../__tests__/identity-lock";
import { makeTempDir } from "../../__tests__/temp-dir";

// vitest types its asymmetric matchers `any`; naming one keeps the assertion typed.
const anyNumber: unknown = expect.any(Number);

const bootService = () => {
  const root = makeTempDir("inteligir-vault-test-");
  const notifier = createNotifierRecorder();
  let mutations = 0;
  const service = createVaultService({
    lock: identityLock,
    notifier,
    onMutated: () => {
      mutations += 1;
    },
    root,
  });
  return { mutationCount: () => mutations, notifier, root, service };
};

describe("what the vault is CALLED", () => {
  it("is the root's last segment, split by the side that owns the separator", async () => {
    const { root, service } = bootService();
    const tree = await service.listTree();
    expect(tree.name).toBe(path.basename(root));
  });
});

describe("vault CRUD", () => {
  it("round-trips write → list → read → rename → delete", async () => {
    const { notifier, service, mutationCount } = bootService();

    await service.write("notes/today.md", "# Today\n");
    expect(notifier.docChanges).toEqual([
      { changes: ["content-changed"], docId: "notes/today.md" },
    ]);
    expect(notifier.vaultChanges).toEqual([["files-changed"]]);

    const tree = await service.listTree();
    expect(tree.entries).toEqual([
      { kind: "dir", path: "notes" },
      { kind: "file", modifiedMs: anyNumber, path: "notes/today.md" },
    ]);

    const read = await service.read("notes/today.md");
    expect(read).toEqual({ content: "# Today\n", path: "notes/today.md" });

    const renamed = await service.rename("notes/today.md", "notes/renamed.md");
    expect(renamed.path).toBe("notes/renamed.md");
    await expect(service.read("notes/today.md")).rejects.toThrow(VaultServiceError);
    const reread = await service.read("notes/renamed.md");
    expect(reread.content).toBe("# Today\n");

    await service.remove("notes/renamed.md");
    await expect(service.read("notes/renamed.md")).rejects.toThrow(VaultServiceError);
    expect(mutationCount()).toBe(3);
  });

  it("creates directories, and deletes them recursively", async () => {
    const { service } = bootService();
    await service.createDir("projects/alpha");
    await service.write("projects/alpha/plan.md", "plan");
    await service.remove("projects");
    const emptied = await service.listTree();
    expect(emptied.entries).toEqual([]);
  });

  it("refuses to overwrite an existing entry on rename", async () => {
    const { service } = bootService();
    await service.write("a.md", "a");
    await service.write("b.md", "b");
    await expect(service.rename("a.md", "b.md")).rejects.toMatchObject({ code: "conflict" });
  });

  it("hides .git and never serves paths into it", async () => {
    const { root, service } = bootService();
    await mkdir(path.join(root, ".git"), { recursive: true });
    await writeFile(path.join(root, ".git", "config"), "[core]\n");
    await service.write("real.md", "x");

    const visible = await service.listTree();
    expect(visible.entries).toEqual([{ kind: "file", modifiedMs: anyNumber, path: "real.md" }]);
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
    expect(await readFile(path.join(root, "note.md"), "utf-8")).toBe("rewritten");

    const stale = await service.writeIfUnchanged("note.md", "original", "clobber");
    expect(stale).toEqual({ applied: false, reason: "changed" });
    expect(await readFile(path.join(root, "note.md"), "utf-8")).toBe("rewritten");

    const missing = await service.writeIfUnchanged("ghost.md", "x", "y");
    expect(missing).toEqual({ applied: false, reason: "not_found" });
  });

  it("runs every mutation through the injected lock, serialized", async () => {
    const root = makeTempDir("inteligir-vault-test-");
    let chain: Promise<unknown> = Promise.resolve();
    const lock = async <T>(work: () => Promise<T>): Promise<T> => {
      const next = chain.then(work, work);
      chain = next.catch(() => {});
      return await next;
    };
    const service = createVaultService({ lock, notifier: createNotifierRecorder(), root });

    const holder: PromiseWithResolvers<void> = Promise.withResolvers();
    void lock(async () => {
      await holder.promise;
    });
    const write = service.write("held.md", "waited for the lock");
    await delay(50);
    await expect(stat(path.join(root, "held.md"))).rejects.toThrow();

    holder.resolve();
    await write;
    expect(await readFile(path.join(root, "held.md"), "utf-8")).toBe("waited for the lock");
  });
});

describe("what a write announces", () => {
  it("says content-changed alone when only the bytes moved", async () => {
    const { notifier, service } = bootService();
    await service.write("note.md", "one");
    notifier.reset();

    await service.write("note.md", "two");

    expect(notifier.docChanges).toEqual([{ changes: ["content-changed"], docId: "note.md" }]);
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
    // the kill window: tmp landed, rename never ran.
    const { root, service } = bootService();
    await writeFile(path.join(root, `${VAULT_TMP_PREFIX}deadbeef`), "half a note");

    const swept = await service.listTree();
    expect(swept.entries).toEqual([]);
    await service.write("note.md", "the real write");
    const written = await service.read("note.md");
    expect(written.content).toBe("the real write");

    // cutoff in the future: fs mtime granularity is coarse on ci tmpfs.
    await sweepStaleTmpFiles(root, Date.now() + 60_000);
    const names = await readdir(root);
    expect(names.filter((name) => name.startsWith(VAULT_TMP_PREFIX))).toEqual([]);
  });

  it("a sweep leaves an in-flight write's staging file alone", async () => {
    // cutoff in the past: a Date.now() taken just before the write raced the fs mtime granularity and flaked.
    const { root } = bootService();
    const before = Date.now() - 60_000;
    await writeFile(path.join(root, `${VAULT_TMP_PREFIX}inflight`), "half a note");

    await sweepStaleTmpFiles(root, before);
    const remaining = await readdir(root);
    expect(remaining.filter((name) => name.startsWith(VAULT_TMP_PREFIX))).toEqual([
      `${VAULT_TMP_PREFIX}inflight`,
    ]);
  });

  it("an overwrite lands the staged content exactly, shorter than the original included", async () => {
    const { root, service } = bootService();
    await service.write("note.md", "aaaaaaaaaa");
    await service.write("note.md", "bb");
    const content = await readFile(path.join(root, "note.md"), "utf-8");
    expect(content).toBe("bb");
    const stats = await stat(path.join(root, "note.md"));
    expect(stats.size).toBe(2);
  });
});

describe("physical containment (symlinks)", () => {
  it("refuses a symlink LEAF on every surface — a pulled link must never read outside bytes", async () => {
    const { root, service } = bootService();
    const outside = makeTempDir("inteligir-outside-");
    await writeFile(path.join(outside, "id_ed25519"), "SECRET KEY MATERIAL");
    await symlink(path.join(outside, "id_ed25519"), path.join(root, "notes.md"));

    await expect(service.read("notes.md")).rejects.toThrow(VaultPathError);
    await expect(service.write("notes.md", "overwrite")).rejects.toThrow(VaultPathError);
    await expect(service.remove("notes.md")).rejects.toThrow(VaultPathError);
    await expect(service.rename("notes.md", "elsewhere.md")).rejects.toThrow(VaultPathError);
    expect(await readFile(path.join(outside, "id_ed25519"), "utf-8")).toBe("SECRET KEY MATERIAL");
  });

  it("refuses operating THROUGH a symlinked folder — nothing lands or reads outside", async () => {
    const { root, service } = bootService();
    const outside = makeTempDir("inteligir-outside-");
    await writeFile(path.join(outside, "readable.txt"), "outside content");
    await symlink(outside, path.join(root, "evil"), "dir");

    await expect(service.write("evil/x.md", "escape")).rejects.toThrow(VaultPathError);
    await expect(service.write("evil/deep/x.md", "escape")).rejects.toThrow(VaultPathError);
    await expect(service.createDir("evil/newdir")).rejects.toThrow(VaultPathError);
    await expect(service.read("evil/readable.txt")).rejects.toThrow(VaultPathError);
    await expect(service.rename("evil/readable.txt", "stolen.md")).rejects.toThrow(VaultPathError);

    expect(await readdir(outside)).toEqual(["readable.txt"]);
    expect(await readFile(path.join(outside, "readable.txt"), "utf-8")).toBe("outside content");
  });

  it("keeps symlinks out of the listing entirely", async () => {
    const { root, service } = bootService();
    const outside = makeTempDir("inteligir-outside-");
    await writeFile(path.join(outside, "secret.txt"), "s");
    await symlink(path.join(outside, "secret.txt"), path.join(root, "file-link.md"));
    await symlink(outside, path.join(root, "dir-link"), "dir");
    await service.write("real.md", "x");

    const contained = await service.listTree();
    expect(contained.entries).toEqual([{ kind: "file", modifiedMs: anyNumber, path: "real.md" }]);
  });
});

describe("where an attachment lands", () => {
  it('takes "" as the root, and creates a folder on the first write into it', async () => {
    const { root, service } = bootService();
    const bytes = new Uint8Array([137, 80, 78, 71]);
    expect(await service.writeAsset("", "shot.png", bytes)).toEqual({ path: "shot.png" });
    expect(await service.writeAsset("media/2026", "shot.png", bytes)).toEqual({
      path: "media/2026/shot.png",
    });
    const assetDir = await stat(path.join(root, "media", "2026"));
    expect(assetDir.isDirectory()).toBe(true);
  });
});
