import { execFile, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
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
import { promisify } from "node:util";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { createThread, getThread } from "@repo/db/threads";
import { noopNotifier } from "@repo/domain/notifier";
import { contentHashHex } from "@repo/contract/local/vault/vault-schema";
import type { VaultTreeResponse } from "@repo/contract/local/vault/vault-schema";
import { VaultPathError, VAULT_TMP_PREFIX } from "@repo/notes/knowledge/vault-path";
import { removeEntryWithComments } from "../../comments/remove-with-comments";
import { snapshotDocs } from "../../knowledge/snapshot-docs";
import { BACKGROUND_READ_SLOTS, READ_SLOTS, REQUEST_READ_SLOTS } from "../read-slots";
import { slowReadStall } from "../slow-reads";
import type { VaultMutation } from "../vault-changes";
import { createVaultService, sweepStaleTmpFiles, VaultServiceError } from "../vault-service";
import { bootTestApp } from "../../__tests__/boot-app";
import { identityLock } from "../../__tests__/identity-lock";
import { ignoreFromDisk } from "../../__tests__/ignore-from-disk";
import { makeTempDir } from "../../__tests__/temp-dir";

// vitest types its asymmetric matchers `any`; naming one keeps the assertion typed.
const anyNumber: unknown = expect.any(Number);

const bootService = () => {
  const root = makeTempDir("inteligir-vault-test-");
  const reports: (readonly VaultMutation[])[] = [];
  const service = createVaultService({
    ignore: ignoreFromDisk(root),
    lock: identityLock,
    onMutated: (mutations) => {
      reports.push(mutations);
    },
    root,
  });
  // what each report said moved, by path, without the fingerprints a test cannot predict.
  const reported = () =>
    reports.map((mutations) =>
      mutations.map(({ kind, path: changed }) => ({ kind, path: changed })),
    );
  return { reported, reports, root, service };
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
    const { reports, service } = bootService();

    await service.write("notes/today.md", "# Today\n");

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
    expect(reports).toHaveLength(3);
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

describe("what a mutation reports", () => {
  it("reports a write over an existing note as content, its row unmoved", async () => {
    const { reported, service } = bootService();
    await service.write("note.md", "one");
    await service.write("note.md", "two");
    await service.writeIfUnchanged("note.md", "two", "three");
    await service.writeGuarded("note.md", "four", {
      hash: await contentHashHex("three"),
      kind: "expected",
    });

    expect(reported().slice(1)).toEqual([
      [{ kind: "content", path: "note.md" }],
      [{ kind: "content", path: "note.md" }],
      [{ kind: "content", path: "note.md" }],
    ]);
  });

  it("reports a create, a folder, a rename's two ends and a delete as entries", async () => {
    const { reported, service } = bootService();
    await service.write("fresh.md", "one");
    await service.writeGuarded("guarded.md", "one", { kind: "absent" });
    await service.writeAsset("assets", "shot.png", new Uint8Array([1]));
    await service.createDir("folder");
    await service.rename("fresh.md", "folder/moved.md");
    await service.remove("guarded.md");
    await service.removeIfUnchanged("folder/moved.md", "one");

    expect(reported()).toEqual([
      [{ kind: "entry", path: "fresh.md" }],
      [{ kind: "entry", path: "guarded.md" }],
      [{ kind: "entry", path: "assets/shot.png" }],
      [{ kind: "entry", path: "folder" }],
      [
        { kind: "entry", path: "fresh.md" },
        { kind: "entry", path: "folder/moved.md" },
      ],
      [{ kind: "entry", path: "guarded.md" }],
      [{ kind: "entry", path: "folder/moved.md" }],
    ]);
  });

  it("reports nothing for a guarded write it refused", async () => {
    const { reported, service } = bootService();
    await service.write("note.md", "one");
    await service.writeIfUnchanged("note.md", "stale", "two");
    await service.writeGuarded("note.md", "two", { kind: "absent" });
    await service.removeIfUnchanged("note.md", "stale");

    expect(reported()).toEqual([[{ kind: "entry", path: "note.md" }]]);
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
    await sweepStaleTmpFiles(root, Date.now() + 60_000, await ignoreFromDisk(root)());
    const names = await readdir(root);
    expect(names.filter((name) => name.startsWith(VAULT_TMP_PREFIX))).toEqual([]);
  });

  it("a sweep leaves an in-flight write's staging file alone", async () => {
    // cutoff in the past: a Date.now() taken just before the write raced the fs mtime granularity and flaked.
    const { root } = bootService();
    const before = Date.now() - 60_000;
    await writeFile(path.join(root, `${VAULT_TMP_PREFIX}inflight`), "half a note");

    await sweepStaleTmpFiles(root, before, await ignoreFromDisk(root)());
    const remaining = await readdir(root);
    expect(remaining.filter((name) => name.startsWith(VAULT_TMP_PREFIX))).toEqual([
      `${VAULT_TMP_PREFIX}inflight`,
    ]);
  });

  it("never enters a folder the vault ignores, so a staging file under one stays", async () => {
    const { root } = bootService();
    await writeFile(path.join(root, ".gitignore"), "node_modules/\n");
    const ignored = path.resolve(root, "node_modules");
    await mkdir(path.join(ignored, "pkg"), { recursive: true });
    await writeFile(path.join(ignored, "pkg", `${VAULT_TMP_PREFIX}stale`), "half a package");
    await writeFile(path.join(root, `${VAULT_TMP_PREFIX}stale`), "half a note");
    const ignore = await ignoreFromDisk(root)();
    const readdirSpy = vi.spyOn(fsPromises, "readdir");
    syncBuiltinESMExports();
    onTestFinished(() => {
      readdirSpy.mockRestore();
      syncBuiltinESMExports();
    });

    await sweepStaleTmpFiles(root, Date.now() + 60_000, ignore);

    const walked = readdirSpy.mock.calls.map(([dir]) => String(dir));
    expect(walked).toContain(path.resolve(root));
    expect(walked.filter((dir) => dir.startsWith(ignored))).toEqual([]);
    expect(await readdir(root)).not.toContain(`${VAULT_TMP_PREFIX}stale`);
    expect(await readdir(path.join(ignored, "pkg"))).toEqual([`${VAULT_TMP_PREFIX}stale`]);
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
    await expect(service.readBytes("notes.md")).rejects.toThrow(VaultPathError);
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
    await expect(service.statAsset("evil/readable.txt")).rejects.toThrow(VaultPathError);
    await expect(service.rename("evil/readable.txt", "stolen.md")).rejects.toThrow(VaultPathError);

    expect(await readdir(outside)).toEqual(["readable.txt"]);
    expect(await readFile(path.join(outside, "readable.txt"), "utf-8")).toBe("outside content");
  });

  it("answers a symlinked folder and every path through it as no entry, its names unread", async () => {
    const { root, service } = bootService();
    const outside = makeTempDir("inteligir-outside-");
    await mkdir(path.join(outside, "sub"));
    await writeFile(path.join(outside, "secret.md"), "s");
    await writeFile(path.join(outside, "sub", "deeper.md"), "s");
    await symlink(outside, path.join(root, "link"), "dir");

    for (const through of ["link", "link/sub", "link/secret.md", "link/sub/deeper.md"]) {
      expect(await service.statEntry(through)).toBeNull();
      expect(await service.listFilesUnder(through)).toEqual([]);
    }
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

const execFileAsync = promisify(execFile);

// longer than the open a local disk answers, so a read inside it still holds its slot when the
// next one is asked for
const OPEN_MS = 60;

// a save on a local disk lands in milliseconds; past this it is waiting on a thread
const SAVE_DEADLINE_MS = 2000;

// every open of these vault paths answers OPEN_MS late, and the most out at once is counted, all
// of them and the background's alone
const stallOpens = (root: string, lanes: { background: readonly string[]; window: string }) => {
  const rootReal = realpathSync(root);
  // keyed by what readFile is handed, which may be a handle or a url as well as a path
  const lanesByPath = new Map<unknown, "background" | "window">([
    ...lanes.background.map((relPath) => [path.join(rootReal, relPath), "background"] as const),
    [path.join(rootReal, lanes.window), "window"],
  ]);
  const open = { background: 0, window: 0 };
  const peak = { all: 0, background: 0, backgroundBesideWindow: 0 };
  const actualReadFile = fsPromises.readFile;
  const spy = vi.spyOn(fsPromises, "readFile").mockImplementation(async (file, options) => {
    const lane = lanesByPath.get(file);
    if (lane === undefined) {
      return await actualReadFile(file, options);
    }
    open[lane] += 1;
    peak.all = Math.max(peak.all, open.background + open.window);
    peak.background = Math.max(peak.background, open.background);
    if (open.window > 0) {
      peak.backgroundBesideWindow = Math.max(peak.backgroundBesideWindow, open.background);
    }
    try {
      await delay(OPEN_MS);
      return await actualReadFile(file, options);
    } finally {
      open[lane] -= 1;
    }
  });
  syncBuiltinESMExports();
  onTestFinished(() => {
    spy.mockRestore();
    syncBuiltinESMExports();
  });
  return { open, peak };
};

describe("the read budget", () => {
  it("holds the origin repair and an index pass to the background share, and lets the window's read in beside them", async () => {
    const app = await bootTestApp();
    const notes = Array.from({ length: 8 }, (_, index) => `notes/n${String(index)}.md`);
    const ids = new Map(notes.map((note) => [note, randomUUID()]));
    const threads = new Map<string, string>();
    for (const [note, id] of ids) {
      await app.client.vault.write({
        content: `---\nid: ${id}\n---\n# ${note}\n`,
        guard: { kind: "overwrite" },
        path: note,
      });
      threads.set(
        note,
        createThread(app.db, noopNotifier, { origin: { noteId: null, path: note } }).id,
      );
    }
    const picture = "window.png";
    await writeFile(path.join(app.vaultDir, picture), "png bytes");
    const { knowledge } = app.composed.context;
    await knowledge.settle();
    const opens = stallOpens(app.vaultDir, { background: notes, window: picture });

    knowledge.noteVaultChange({ kind: "unknown" });
    const sweeps = Promise.all([
      app.composed.context.threads.repairPathOnlyOrigins(),
      knowledge.settle(),
    ]);
    await vi.waitFor(
      () => {
        expect(opens.open.background).toBe(BACKGROUND_READ_SLOTS);
      },
      { interval: 1, timeout: OPEN_MS * 4 },
    );
    const windowRead = await app.vault.service.readBytes(picture);
    expect(windowRead.path).toBe(picture);
    await sweeps;

    expect(opens.peak).toEqual({
      all: READ_SLOTS,
      background: BACKGROUND_READ_SLOTS,
      backgroundBesideWindow: BACKGROUND_READ_SLOTS,
    });
    for (const [note, threadId] of threads) {
      expect(getThread(app.db, threadId)?.originNoteId).toBe(ids.get(note));
    }
    expect(knowledge.lastReconcile?.deferred).toBe(0);
  });

  it("reads a delete's id scan and a rename's snapshot beside two background reads that have not answered, one doc at a time", async () => {
    const root = makeTempDir("inteligir-vault-test-");
    const evicted = Array.from(
      { length: BACKGROUND_READ_SLOTS },
      (_, index) => `evicted/${String(index)}.md`,
    );
    const fetched = Promise.withResolvers<null>();
    const stalls = { begun: 0 };
    const requested = { open: 0, peak: 0 };
    const service = createVaultService({
      ignore: ignoreFromDisk(root),
      lock: identityLock,
      root,
      stallRead: async (relPath) => {
        if (relPath.startsWith("evicted/")) {
          stalls.begun += 1;
          await fetched.promise;
          return;
        }
        requested.open += 1;
        requested.peak = Math.max(requested.peak, requested.open);
        await delay(OPEN_MS);
        requested.open -= 1;
      },
    });
    const linked = ["linked/a.md", "linked/b.md", "linked/c.md"];
    for (const file of [...evicted, ...linked, "gone/a.md", "gone/b.md"]) {
      await service.write(file, `# ${file}\n`);
    }
    const knowledge = { noteIdOwners: async () => await Promise.resolve([]) };

    const background = Promise.all(
      evicted.map(async (file) => await service.read(file, "background")),
    );
    await vi.waitFor(() => {
      expect(stalls.begun).toBe(BACKGROUND_READ_SLOTS);
    });
    const [snapshot, removed] = await Promise.all([
      snapshotDocs(service, linked),
      removeEntryWithComments(service, "gone", knowledge),
    ]);
    expect([...snapshot.docs.keys()]).toEqual(linked);
    expect(removed).toEqual(["gone"]);
    fetched.resolve(null);
    await background;

    requested.peak = 0;
    await snapshotDocs(service, linked);
    expect(requested.peak).toBe(REQUEST_READ_SLOTS);
  });

  it("holds a slot through the stand-in's stall, as a stalled open would", async () => {
    const root = makeTempDir("inteligir-vault-test-");
    const stalled = Array.from({ length: READ_SLOTS }, (_, index) => `slow/${String(index)}.md`);
    const stalls = { begun: 0, ended: 0, endedWhenFastBegan: -1 };
    const service = createVaultService({
      ignore: ignoreFromDisk(root),
      lock: identityLock,
      root,
      stallRead: async (relPath) => {
        if (relPath === "fast.md") {
          stalls.endedWhenFastBegan = stalls.ended;
          return;
        }
        stalls.begun += 1;
        await delay(STALL_MS);
        stalls.ended += 1;
      },
    });
    for (const file of [...stalled, "fast.md"]) {
      await service.write(file, `# ${file}\n`);
    }

    const slow = Promise.all(stalled.map(async (file) => await service.read(file)));
    await vi.waitFor(() => {
      expect(stalls.begun).toBe(READ_SLOTS);
    });
    await service.read("fast.md");
    await slow;

    expect(stalls.endedWhenFastBegan).toBeGreaterThan(0);
  });

  it("leaves node a thread for a save while every slot is held by an open that never answers", async () => {
    const { root, service } = bootService();
    // a pipe with no writer blocks its reader inside open(), holding one of node's fs threads,
    // which is what an open of a placeholder the storage has not fetched does
    const pipes = Array.from({ length: READ_SLOTS + 1 }, (_, index) => `pipe-${String(index)}.md`);
    for (const pipe of pipes) {
      execFileSync("mkfifo", [path.join(root, pipe)]);
    }
    const reads = pipes.map(async (pipe) => await service.read(pipe));
    try {
      await delay(OPEN_MS);
      const saved = await Promise.race([
        service.write("note.md", "saved"),
        delay(SAVE_DEADLINE_MS, "stalled"),
      ]);
      expect(saved).toEqual({ path: "note.md" });
    } finally {
      // the writers are a shell's, since node's own fs is what may be stalled
      const writers = pipes.map((pipe) => `: > '${pipe}' &`).join(" ");
      await execFileAsync("sh", ["-c", `${writers} wait`], { cwd: root });
    }
    expect(await Promise.all(reads)).toEqual(pipes.map((pipe) => ({ content: "", path: pipe })));
    expect(await readFile(path.join(root, "note.md"), "utf-8")).toBe("saved");
  });
});
