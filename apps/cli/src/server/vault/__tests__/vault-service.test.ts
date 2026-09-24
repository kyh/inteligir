import fsPromises, {
  chmod,
  mkdir,
  readdir,
  readFile,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { contentHashHex } from "@repo/api/local/vault/vault-schema";
import type { VaultTreeResponse } from "@repo/api/local/vault/vault-schema";
import { VaultPathError, VAULT_TMP_PREFIX } from "@repo/notes/knowledge/vault-path";
import { slowReadStall } from "../slow-reads";
import { createVaultService, sweepStaleTmpFiles, VaultServiceError } from "../vault-service";
import { createNotifierRecorder } from "./notifier-recorder";
import { identityLock } from "../../__tests__/identity-lock";
import { ignoreFromDisk } from "../../__tests__/ignore-from-disk";
import { makeTempDir } from "../../__tests__/temp-dir";

// vitest types its asymmetric matchers `any`; naming one keeps the assertion typed.
const anyNumber: unknown = expect.any(Number);

const bootService = () => {
  const root = makeTempDir("inteligir-vault-test-");
  const notifier = createNotifierRecorder();
  let mutations = 0;
  const service = createVaultService({
    ignore: ignoreFromDisk(root),
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
    const service = createVaultService({
      ignore: ignoreFromDisk(root),
      lock,
      notifier: createNotifierRecorder(),
      root,
    });

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
    await service.writeGuarded("guarded.md", "one", { kind: "absent" });
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
  const bytes = new Uint8Array([137, 80, 78, 71]);

  it('takes "" as the root, and creates a folder on the first write into it', async () => {
    const { root, service } = bootService();
    expect(await service.writeAsset("", "shot.png", bytes)).toEqual({ path: "shot.png" });
    expect(await service.writeAsset("media/2026", "shot.png", bytes)).toEqual({
      path: "media/2026/shot.png",
    });
    const assetDir = await stat(path.join(root, "media", "2026"));
    expect(assetDir.isDirectory()).toBe(true);
  });

  it("lands every paste of one name, however many the folder already holds", async () => {
    // seeded on disk rather than written through the service: 1500 fsynced writes outrun the
    // test's budget, and the folder cannot tell the two apart.
    const { root, service } = bootService();
    const assets = path.join(root, "assets");
    await mkdir(assets);
    const seeded = 1498;
    await Promise.all(
      Array.from({ length: seeded }, async (_, index) => {
        const n = index + 1;
        await writeFile(path.join(assets, n === 1 ? "shot.png" : `shot-${n}.png`), "seed");
      }),
    );

    expect(await service.writeAsset("assets", "shot.png", bytes)).toEqual({
      path: "assets/shot-1499.png",
    });
    expect(await service.writeAsset("assets", "shot.png", bytes)).toEqual({
      path: "assets/shot-1500.png",
    });
    expect(await readdir(assets)).toHaveLength(1500);
  });

  it("steps past a name the folder holds in another case", async () => {
    const { root, service } = bootService();
    await mkdir(path.join(root, "assets"));
    await writeFile(path.join(root, "assets", "Shot.png"), "theirs");
    expect(await service.writeAsset("assets", "shot.png", bytes)).toEqual({
      path: "assets/shot-2.png",
    });
    expect(await readFile(path.join(root, "assets", "Shot.png"), "utf-8")).toBe("theirs");
  });
});

// the permission cases need a user the mode binds; root reads through a 000 mode.
const modesBind = process.platform !== "win32" && process.getuid?.() !== 0;

describe("what the filesystem throws at the vault", () => {
  it("answers a file standing where a folder must be as a conflict, on every surface", async () => {
    const { service } = bootService();
    await service.write("file.md", "x");
    await service.write("other.md", "y");

    await expect(service.write("file.md/child.md", "z")).rejects.toMatchObject({
      code: "conflict",
    });
    await expect(
      service.writeGuarded("file.md/child.md", "z", { kind: "absent" }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(service.rename("other.md", "file.md/other.md")).rejects.toMatchObject({
      code: "conflict",
    });
    await expect(service.createDir("file.md/sub")).rejects.toMatchObject({ code: "conflict" });
    await expect(
      service.writeAsset("file.md", "shot.png", new Uint8Array([1])),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(await service.read("other.md")).toEqual({ content: "y", path: "other.md" });
  });

  it.runIf(modesBind)(
    "lists around a folder it cannot open, keeping the folder's own row",
    async () => {
      const root = makeTempDir("inteligir-vault-test-");
      const reported: string[] = [];
      const service = createVaultService({
        ignore: ignoreFromDisk(root),
        lock: identityLock,
        notifier: createNotifierRecorder(),
        onUnreadableFolder: (relPath, code) => {
          reported.push(`${relPath}: ${code}`);
        },
        root,
      });
      await service.write("locked/secret.md", "s");
      await service.write("open/note.md", "n");
      await service.write("top.md", "t");

      const locked = path.join(root, "locked");
      await chmod(locked, 0o000);
      let tree: VaultTreeResponse;
      try {
        tree = await service.listTree();
      } finally {
        await chmod(locked, 0o755);
      }

      expect(tree.entries.map((entry) => entry.path)).toEqual([
        "locked",
        "open",
        "open/note.md",
        "top.md",
      ]);
      expect(reported).toEqual(["locked: EACCES"]);
    },
  );

  it.runIf(modesBind)("keeps a file's mode across every overwrite", async () => {
    const { root, service } = bootService();
    const absPath = path.join(root, "private.md");
    await service.write("private.md", "one");
    await chmod(absPath, 0o600);

    await service.write("private.md", "two");
    await service.writeGuarded("private.md", "three", {
      hash: await contentHashHex("two"),
      kind: "expected",
    });
    await service.writeIfUnchanged("private.md", "three", "four");

    expect(await readFile(absPath, "utf-8")).toBe("four");
    const { mode } = await stat(absPath);
    expect(mode % 0o1000).toBe(0o600);
  });

  it.runIf(modesBind)(
    "reports a compare-and-swap read it cannot make, never a file that is gone",
    async () => {
      const { root, service } = bootService();
      await service.write("sealed.md", "bytes");
      const absPath = path.join(root, "sealed.md");
      await chmod(absPath, 0o000);
      try {
        await expect(service.writeIfUnchanged("sealed.md", "bytes", "x")).rejects.toMatchObject({
          code: "EACCES",
        });
        await expect(service.removeIfUnchanged("sealed.md", "bytes")).rejects.toMatchObject({
          code: "EACCES",
        });
        await expect(
          service.writeGuarded("sealed.md", "x", {
            hash: await contentHashHex("bytes"),
            kind: "expected",
          }),
        ).rejects.toMatchObject({ code: "EACCES" });
      } finally {
        await chmod(absPath, 0o644);
      }
    },
  );

  it("moves a note by rename where the filesystem refuses a hard link", async () => {
    const { root, service } = bootService();
    await service.write("from.md", "moved bytes");
    const refused = Object.assign(new Error("operation not permitted"), { code: "EPERM" });
    const link = vi.spyOn(fsPromises, "link").mockRejectedValue(refused);
    syncBuiltinESMExports();
    onTestFinished(() => {
      link.mockRestore();
      syncBuiltinESMExports();
    });

    expect(await service.rename("from.md", "nested/to.md")).toEqual({ path: "nested/to.md" });

    expect(link).toHaveBeenCalled();
    expect(await readFile(path.join(root, "nested", "to.md"), "utf-8")).toBe("moved bytes");
    await expect(stat(path.join(root, "from.md"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

// long enough that a local read never takes it, so answer order says which reads it held
const STALL_MS = 500;

describe("a read stall", () => {
  it("holds the reads of its path and everything under it, and no other", async () => {
    const root = makeTempDir("inteligir-vault-test-");
    const service = createVaultService({
      ignore: ignoreFromDisk(root),
      lock: identityLock,
      notifier: createNotifierRecorder(),
      root,
      stallRead: slowReadStall({ delayMs: STALL_MS, path: "slow" }),
    });
    for (const file of ["slow/a.md", "slow/b.md", "slow.md", "slower/c.md"]) {
      await service.write(file, `# ${file}\n`);
    }

    const answered: string[] = [];
    await Promise.all([
      (async () => {
        await service.readBytes("slow/a.md");
        answered.push("slow/a.md");
      })(),
      (async () => {
        await service.read("slow/b.md");
        answered.push("slow/b.md");
      })(),
      (async () => {
        await service.readBytes("slow.md");
        answered.push("slow.md");
      })(),
      (async () => {
        await service.read("slower/c.md");
        answered.push("slower/c.md");
      })(),
    ]);
    expect(answered.slice(0, 2).toSorted()).toEqual(["slow.md", "slower/c.md"]);
    expect(answered.slice(2).toSorted()).toEqual(["slow/a.md", "slow/b.md"]);
  });
});
