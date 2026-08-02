import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  VaultListingIncompleteError,
  VaultManager,
  resumeVaultWrites,
  suspendVaultWrites,
} from "../vault";

let tmp: string;
let root: string;
let settingsPath: string;

/** Let the OS deliver a filesystem watch event and our debounce settle. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 250));

function newManager(): VaultManager {
  return new VaultManager({ settingsPath, defaultRoot: root, manageAgentLink: false });
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vault-test-"));
  root = path.join(tmp, "vault");
  settingsPath = path.join(tmp, "settings.json");
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("VaultManager", () => {
  it("defaults to the provided root and creates it on ensureReady", () => {
    const mgr = newManager();
    expect(mgr.getRoot()).toBe(root);
    mgr.ensureReady();
    expect(fs.existsSync(root)).toBe(true);
  });

  it("round-trips text docs and lists them", () => {
    const mgr = newManager();
    mgr.writeText("notes/hello.md", "# Hi");
    expect(mgr.readText("notes/hello.md")).toBe("# Hi");
    const list = mgr.list();
    expect(list).toContainEqual({ path: "notes/hello.md", name: "hello.md", kind: "doc" });
  });

  it("excludes sibling .tmp files from the listing", () => {
    const mgr = newManager();
    mgr.writeText("note.md", "hi");
    fs.writeFileSync(path.join(root, "note.md.tmp"), "in-flight");
    const names = mgr.list().map((e) => e.path);
    expect(names).toContain("note.md");
    expect(names).not.toContain("note.md.tmp");
  });

  it("read-through never resets a malformed file — the bytes survive", () => {
    const mgr = newManager();
    mgr.writeText("broken.json", "{ not json");
    // Unlike JsonStore, the vault reads through to disk and never quarantines
    // or rewrites user-owned files.
    expect(mgr.readText("broken.json")).toBe("{ not json");
  });

  it("confines paths to the vault root", () => {
    const mgr = newManager();
    mgr.ensureReady();
    expect(() => mgr.readText("../escape.md")).toThrow(/escapes the vault/);
    expect(() => mgr.writeText("../../evil.md", "x")).toThrow(/escapes the vault/);
    expect(() => mgr.writeText("/etc/passwd", "x")).toThrow(/escapes the vault/);
  });

  // Symlink-safe confinement: the lexical check alone lets a symlink
  // planted INSIDE the vault escape it, so resolve() also realpaths the target.
  // Realpath the root in these assertions: on macOS os.tmpdir() lives under a
  // symlinked ancestor (/var → /private/var), so the lexical root differs from
  // its canonical form.
  it("blocks reading through a symlink that points to a file outside the vault", () => {
    const mgr = newManager();
    mgr.ensureReady();
    const outside = path.join(tmp, "outside.md");
    fs.writeFileSync(outside, "secret");
    fs.symlinkSync(outside, path.join(fs.realpathSync(root), "link.md"));
    expect(() => mgr.readText("link.md")).toThrow(/escapes the vault/);
  });

  it("blocks writing through a symlinked directory that points outside the vault", () => {
    const mgr = newManager();
    mgr.ensureReady();
    const outsideDir = path.join(tmp, "outside-dir");
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.symlinkSync(outsideDir, path.join(fs.realpathSync(root), "link-dir"), "dir");
    expect(() => mgr.writeText("link-dir/x.md", "x")).toThrow(/escapes the vault/);
    // The target dir stays untouched — nothing leaked out.
    expect(fs.existsSync(path.join(outsideDir, "x.md"))).toBe(false);
  });

  it("still allows a symlink that points to another file inside the vault", () => {
    const mgr = newManager();
    mgr.writeText("real.md", "hello");
    fs.symlinkSync(
      path.join(fs.realpathSync(root), "real.md"),
      path.join(fs.realpathSync(root), "inlink.md"),
    );
    expect(mgr.readText("inlink.md")).toBe("hello");
  });

  it("still creates a brand-new (non-existent) file inside the vault", () => {
    const mgr = newManager();
    mgr.writeText("fresh/new.md", "x");
    expect(mgr.readText("fresh/new.md")).toBe("x");
  });

  it("deletes files", () => {
    const mgr = newManager();
    mgr.writeText("temp.md", "x");
    expect(mgr.delete("temp.md")).toBe(true);
    expect(mgr.delete("temp.md")).toBe(false);
    expect(fs.existsSync(path.join(root, "temp.md"))).toBe(false);
  });

  it("refuses a root inside the app data dir (wiped on logout)", () => {
    const mgr = newManager();
    const inside = path.join(os.homedir(), ".inteligir", "vault");
    expect(() => mgr.setRoot(inside)).toThrow(/app data directory/);
    // The root is unchanged.
    expect(mgr.getRoot()).toBe(root);
  });

  it("blocks writes while suspended (signed out) and resumes after", () => {
    const mgr = newManager();
    mgr.writeText("a.md", "before");
    suspendVaultWrites();
    try {
      expect(() => mgr.writeText("a.md", "during")).toThrow(/signed out/);
      expect(() => mgr.delete("a.md")).toThrow(/signed out/);
      // The pre-suspension content is untouched.
      expect(mgr.readText("a.md")).toBe("before");
    } finally {
      resumeVaultWrites();
    }
    mgr.writeText("a.md", "after");
    expect(mgr.readText("a.md")).toBe("after");
  });

  it("list() is uncapped and agrees with listAllPaths() on a plain vault (ephemeral listing)", () => {
    const mgr = newManager();
    mgr.ensureReady();
    // Past the old 2,000 cap — the crawl is on-demand now, so there is no cap
    // (vault liveness — CLAUDE.md § Decisions). Both listings must see every
    // file, and agree.
    const TOTAL = 2050;
    for (let i = 0; i < TOTAL; i++) {
      const name = `f${String(i).padStart(4, "0")}.md`;
      fs.writeFileSync(path.join(root, name), "x");
    }
    // Plant entries that must be excluded from both listings.
    fs.mkdirSync(path.join(root, ".git"), { recursive: true });
    fs.writeFileSync(path.join(root, ".git", "x"), "x");
    fs.writeFileSync(path.join(root, "foo.tmp"), "x");
    fs.writeFileSync(path.join(root, ".dotfile"), "x");

    expect(mgr.list().length).toBe(TOTAL);
    expect(mgr.listAllPaths().length).toBe(TOTAL);
    expect(mgr.list().map((e) => e.path)).toEqual(mgr.listAllPaths());

    const all = mgr.listAllPaths();
    expect(all).not.toContain(".git/x");
    expect(all).not.toContain("foo.tmp");
    expect(all).not.toContain(".dotfile");
  });

  // ---- Crawl completeness (the sync mass-deletion guard's Layer 1) ----------
  // A truncated/empty crawl must NEVER reach the sync manifest as if it were a
  // real state of the vault: reconcile reads "in base, absent from local" as a
  // local delete and fans it out to every device. The shared crawl records
  // completeness; the sync-facing listAllPaths() refuses an incomplete one,
  // while the UI-facing list()/listWithStats() stay lenient on the partial.
  it("listAllPaths() throws when the vault root is missing; list()/listWithStats() stay lenient", async () => {
    const mgr = newManager(); // ensureReady() never called — the root does not exist
    expect(fs.existsSync(root)).toBe(false);

    expect(() => mgr.listAllPaths()).toThrow(VaultListingIncompleteError);
    expect(() => mgr.listAllPaths()).toThrow(/refusing to treat unread files as deleted/);
    // The UI tolerates a momentarily-missing root — empty listing, no throw.
    expect(mgr.list()).toEqual([]);
    await expect(mgr.listWithStats()).resolves.toEqual([]);

    // The root appearing is picked up IMMEDIATELY — an incomplete crawl is
    // never cached, so no TTL window can serve the stale failure.
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, "back.md"), "x");
    expect(mgr.listAllPaths()).toEqual(["back.md"]);
  });

  // chmod-based EACCES needs a non-root uid (root bypasses permission checks).
  it.skipIf(typeof process.getuid === "function" && process.getuid() === 0)(
    "listAllPaths() throws when a subtree readdir fails; list() serves the partial (lenient)",
    async () => {
      const mgr = newManager();
      mgr.writeText("keep.md", "x");
      mgr.writeText("locked/hidden.md", "x");
      const lockedDir = path.join(root, "locked");
      fs.chmodSync(lockedDir, 0o000);
      try {
        // Sync-facing: the truncation is refused, not presented as deletions.
        expect(() => mgr.listAllPaths()).toThrow(VaultListingIncompleteError);
        // UI-facing: lenient — the readable part of the vault still lists.
        const paths = mgr.list().map((e) => e.path);
        expect(paths).toContain("keep.md");
        expect(paths).not.toContain("locked/hidden.md");
        const withStats = await mgr.listWithStats();
        expect(withStats.map((e) => e.path)).toEqual(paths);
      } finally {
        fs.chmodSync(lockedDir, 0o700);
      }
      // Recovery is immediate (incomplete crawls are never cached): with the
      // subtree readable again, sync sees the full listing.
      expect(mgr.listAllPaths()).toEqual(["keep.md", "locked/hidden.md"]);
    },
  );

  // A per-FILE statSync hiccup (a flaky network mount) on a still-present file
  // must never reach sync as a deletion. The crawl doesn't stat, so the file
  // stays LISTED whatever stat does — it cannot fall out of the manifest at all.
  // Its fingerprint goes null instead, which makes the engine re-read the bytes
  // rather than trust a cached hash (and fail the pass loudly if the read is
  // broken too). Only listWithStats() — derived knowledge, lenient and
  // self-healing — omits it until the next pass.
  it("keeps an unstattable file in list()/listAllPaths(); listWithStats() omits it", async () => {
    const mgr = newManager();
    mgr.writeText("keep.md", "x");
    mgr.writeText("flaky.md", "x");

    const realStatSync = fs.statSync.bind(fs);
    const flaky = path.join(root, "flaky.md");
    const statSpy = vi.spyOn(fs, "statSync").mockImplementation((target, options) => {
      // readdir still lists flaky.md, but its stat throws (transient).
      if (target === flaky) throw new Error("EIO: simulated transient stat failure");
      return realStatSync(target, options);
    });
    try {
      // Sync-facing: the file is present, so nothing can read as a deletion.
      expect(mgr.listAllPaths()).toEqual(["flaky.md", "keep.md"]);
      expect(mgr.list().map((e) => e.path)).toEqual(["flaky.md", "keep.md"]);
      // ...and it has no fingerprint, so no cached hash can be reused for it.
      expect(mgr.statFingerprint("flaky.md")).toBeNull();
      expect(mgr.statFingerprint("keep.md")).not.toBeNull();
      // Knowledge-facing: lenient — the unstattable file is simply absent.
      const withStats = await mgr.listWithStats();
      expect(withStats.map((e) => e.path)).toEqual(["keep.md"]);
    } finally {
      statSpy.mockRestore();
    }
    expect(mgr.listAllPaths()).toEqual(["flaky.md", "keep.md"]);
  });

  // Ignoring is a VIEW choice — it declutters the sidebar. Sync reads a path's
  // absence from the manifest as a local DELETE, so an ignore rule must never
  // reach it: writing `archive/` into .gitignore would otherwise propagate a
  // permanent deletion of every file under it to every device (a PARTIAL ignore
  // slips straight past the engine's empty-listing mass-deletion guard).
  it("withholds ignored files from list() but keeps them in listAllPaths()", async () => {
    const mgr = newManager();
    mgr.ensureReady();
    mgr.writeText("keep.md", "x");
    mgr.writeText("build/out.md", "x");
    mgr.writeText("build/nested/deep.md", "x");
    mgr.writeText("logs/today.md", "x");
    mgr.writeText("secret.md", "x");
    fs.writeFileSync(path.join(root, ".gitignore"), "build/\nsecret.md\n");
    fs.writeFileSync(path.join(root, ".ignore"), "logs/\n");

    const visible = mgr.list().map((e) => e.path);
    expect(visible).toEqual(["keep.md"]);
    // The ignore files themselves are dot-prefixed, so already excluded.
    expect(visible).not.toContain(".gitignore");
    // Derived knowledge indexes what the user sees, so it agrees with list().
    expect((await mgr.listWithStats()).map((e) => e.path)).toEqual(visible);

    // Sync sees every file that is actually on disk, still sorted — including
    // the ones nested under an ignored DIRECTORY, which the crawl must descend.
    expect(mgr.listAllPaths()).toEqual([
      "build/nested/deep.md",
      "build/out.md",
      "keep.md",
      "logs/today.md",
      "secret.md",
    ]);
    // ...and can fingerprint each of them off the same crawl.
    for (const rel of mgr.listAllPaths()) expect(mgr.statFingerprint(rel)).not.toBeNull();

    // Ignore filters the view, not access: an ignored file still reads fine.
    expect(mgr.readText("secret.md")).toBe("x");
  });

  it("keeps .tmp files out of BOTH listings, ignored or not", () => {
    const mgr = newManager();
    mgr.ensureReady();
    mgr.writeText("keep.md", "x");
    fs.writeFileSync(path.join(root, "keep.md.tmp"), "in-flight");
    fs.mkdirSync(path.join(root, "build"), { recursive: true });
    fs.writeFileSync(path.join(root, "build", "out.md.tmp"), "in-flight");
    fs.writeFileSync(path.join(root, ".gitignore"), "build/\n");

    expect(mgr.list().map((e) => e.path)).toEqual(["keep.md"]);
    expect(mgr.listAllPaths()).toEqual(["keep.md"]);
  });

  // Completeness is unchanged by the ignore rules: an unreadable subtree is
  // still a truncated crawl, and sync must still refuse it.
  it.skipIf(typeof process.getuid === "function" && process.getuid() === 0)(
    "listAllPaths() still throws when an IGNORED subtree is unreadable",
    () => {
      const mgr = newManager();
      mgr.writeText("keep.md", "x");
      mgr.writeText("build/out.md", "x");
      fs.writeFileSync(path.join(root, ".gitignore"), "build/\n");
      const ignoredDir = path.join(root, "build");
      fs.chmodSync(ignoredDir, 0o000);
      try {
        expect(() => mgr.listAllPaths()).toThrow(VaultListingIncompleteError);
        // UI-facing: lenient, and the ignored subtree was never shown anyway.
        expect(mgr.list().map((e) => e.path)).toEqual(["keep.md"]);
      } finally {
        fs.chmodSync(ignoredDir, 0o700);
      }
      expect(mgr.listAllPaths()).toEqual(["build/out.md", "keep.md"]);
    },
  );

  it("repoints the root and persists it across instances", () => {
    const mgr = newManager();
    mgr.writeText("a.md", "first");
    const next = path.join(tmp, "other-vault");
    mgr.setRoot(next);
    expect(mgr.getRoot()).toBe(next);
    expect(mgr.list()).toEqual([]);
    mgr.writeText("b.md", "second");
    // A fresh manager reads the persisted root.
    const reopened = newManager();
    expect(reopened.getRoot()).toBe(next);
    expect(reopened.readText("b.md")).toBe("second");
  });

  it("statFingerprint changes when content changes and is null for a missing file", () => {
    const mgr = newManager();
    mgr.writeText("note.md", "one");
    const fp1 = mgr.statFingerprint("note.md");
    expect(fp1).not.toBeNull();

    // A stable read → identical fingerprint (licenses hash-cache reuse).
    expect(mgr.statFingerprint("note.md")).toBe(fp1);

    // A content (and size) change must move the fingerprint.
    mgr.writeText("note.md", "one-longer");
    expect(mgr.statFingerprint("note.md")).not.toBe(fp1);

    // Absent file → null, never a throw.
    expect(mgr.statFingerprint("does-not-exist.md")).toBeNull();
  });

  it("statFingerprint returns null for a path escaping the vault (confinement)", () => {
    const mgr = newManager();
    expect(mgr.statFingerprint("../escape.md")).toBeNull();
  });

  it("fileFacts reports byte size + mtime, and tracks a rewrite", () => {
    const mgr = newManager();
    mgr.writeText("note.md", "one");
    const first = mgr.fileFacts("note.md");
    expect(first).not.toBeNull();
    // Size is BYTES, not characters — the UI renders it as such.
    expect(first?.sizeBytes).toBe(Buffer.byteLength("one", "utf8"));
    expect(first?.modifiedMs).toBeGreaterThan(0);

    mgr.writeText("note.md", "one-longer");
    expect(mgr.fileFacts("note.md")?.sizeBytes).toBe(Buffer.byteLength("one-longer", "utf8"));
  });

  it("fileFacts is null for a missing file and for a path escaping the vault", () => {
    const mgr = newManager();
    // Both read as null so a caller cannot distinguish "absent" from "refused"
    // — the same shape statFingerprint returns, never a throw.
    expect(mgr.fileFacts("does-not-exist.md")).toBeNull();
    expect(mgr.fileFacts("../escape.md")).toBeNull();
  });

  // ---- rename: occupancy + case-only (the two APFS/NTFS rename bugs) ---------
  it("refuses to overwrite an exact existing destination", () => {
    const mgr = newManager();
    mgr.writeText("a.md", "A");
    mgr.writeText("b.md", "B");
    expect(mgr.rename("a.md", "b.md")).toEqual({ ok: false, error: "b.md already exists" });
    expect(mgr.readText("a.md")).toBe("A");
    expect(mgr.readText("b.md")).toBe("B");
  });

  it("refuses a case-insensitive collision with a DIFFERENT file", () => {
    // On a case-sensitive dev fs both names can coexist; the refusal keeps
    // the vault portable to the APFS/NTFS machines it syncs to (where the
    // rename would silently clobber).
    const mgr = newManager();
    mgr.writeText("Taken.md", "occupied");
    mgr.writeText("b.md", "B");
    const result = mgr.rename("b.md", "taken.md");
    expect(result).toEqual({ ok: false, error: "taken.md already exists" });
    expect(mgr.readText("Taken.md")).toBe("occupied");
    expect(mgr.readText("b.md")).toBe("B");
  });

  it("refuses a unicode-normalization collision (NFD name vs NFC rename)", () => {
    const mgr = newManager();
    mgr.writeText("café.md", "decomposed"); // café, NFD
    mgr.writeText("b.md", "B");
    const result = mgr.rename("b.md", "café.md"); // café, NFC
    expect(result.ok).toBe(false);
    expect(mgr.readText("b.md")).toBe("B");
  });

  it("allows a case-only self-rename (previously refused on APFS)", () => {
    const mgr = newManager();
    mgr.writeText("meeting notes.md", "content");
    expect(mgr.rename("meeting notes.md", "Meeting Notes.md")).toEqual({ ok: true });
    expect(mgr.readText("Meeting Notes.md")).toBe("content");
    const names = mgr.list().map((e) => e.name);
    expect(names).toContain("Meeting Notes.md");
    expect(names).not.toContain("meeting notes.md");
  });

  it("renames into a not-yet-existing directory (trivially unoccupied)", () => {
    const mgr = newManager();
    mgr.writeText("a.md", "A");
    expect(mgr.rename("a.md", "brand/new/dir/a.md")).toEqual({ ok: true });
    expect(mgr.readText("brand/new/dir/a.md")).toBe("A");
  });

  // ---- Change notifier kinds (ephemeral listing) -----------------------------
  // A NEW file changes the listing → "refresh" (broadcast). Overwriting an
  // existing file is a content save → "save" (reindex + sync, no broadcast).
  it("fires refresh on new file / delete / rename and save on overwrite", () => {
    const mgr = newManager();
    mgr.ensureReady();
    const kinds: string[] = [];
    mgr.startWatching((_root, kind) => kinds.push(kind));

    mgr.writeText("a.md", "one"); // new file
    mgr.writeText("a.md", "two"); // overwrite (autosave-shaped)
    mgr.writeBytes("img.png", new Uint8Array([1])); // new binary
    mgr.delete("a.md");
    mgr.writeText("b.md", "x");
    mgr.rename("b.md", "c.md");

    expect(kinds).toEqual(["refresh", "save", "refresh", "refresh", "refresh", "refresh"]);
  });

  // ---- Open-note watcher (ephemeral listing) ---------------------------------
  // A real (non-recursive) single-file watch: external edits to the open note
  // broadcast "refresh"; the app's own autosave (markSelfSave) is filtered.
  it("open-note watcher broadcasts external edits but filters self-saves", async () => {
    const mgr = newManager();
    mgr.ensureReady();
    mgr.writeText("open.md", "original");
    const events: string[] = [];
    mgr.startWatching((_root, kind) => events.push(kind));
    mgr.watchOpenNote("open.md");

    // App autosave: write, then mark it a self-save — the watch event is filtered.
    mgr.writeText("open.md", "app-edit");
    mgr.markSelfSave("open.md");
    await settle();
    const afterSelfSave = events.filter((k) => k === "refresh").length;

    // External edit (NOT via the editor write path → not marked) → broadcast.
    fs.writeFileSync(path.join(root, "open.md"), "external-edit");
    await settle();
    const afterExternal = events.filter((k) => k === "refresh").length;
    expect(afterExternal).toBeGreaterThan(afterSelfSave);

    mgr.stopWatching();
  });
});

// User-initiated deletes go to the OS trash through the injected platform
// capability; sync-applied remote deletes keep the permanent delete(). The
// fallback pins today's Linux-without-a-trash behavior: permanent remove.
describe("VaultManager.trash", () => {
  function newTrashManager(trashItem: (abs: string) => Promise<void>): VaultManager {
    return new VaultManager({ settingsPath, defaultRoot: root, manageAgentLink: false, trashItem });
  }

  it("hands the injected trashItem the confined absolute path and notifies refresh", async () => {
    const trashed: string[] = [];
    const mgr = newTrashManager(async (abs) => {
      trashed.push(abs);
      fs.rmSync(abs, { force: true }); // a real trash moves the file away
    });
    mgr.writeText("a.md", "bye");
    const kinds: string[] = [];
    mgr.startWatching((_root, kind) => kinds.push(kind));

    await expect(mgr.trash("a.md")).resolves.toBe(true);
    expect(trashed).toEqual([path.join(root, "a.md")]);
    expect(mgr.list().map((e) => e.path)).not.toContain("a.md");
    expect(kinds).toEqual(["refresh"]);
  });

  it("falls back to a permanent remove when the platform can't trash", async () => {
    const mgr = newTrashManager(async () => {
      throw new Error("no trash implementation on this platform");
    });
    mgr.writeText("a.md", "bye");
    await expect(mgr.trash("a.md")).resolves.toBe(true);
    expect(fs.existsSync(path.join(root, "a.md"))).toBe(false);
  });

  it("returns false for a missing file without touching the platform", async () => {
    let calls = 0;
    const mgr = newTrashManager(async () => {
      calls++;
    });
    mgr.ensureReady();
    await expect(mgr.trash("missing.md")).resolves.toBe(false);
    expect(calls).toBe(0);
  });

  it("confines the path like every other file op", async () => {
    const mgr = newTrashManager(async () => {});
    mgr.ensureReady();
    await expect(mgr.trash("../escape.md")).rejects.toThrow(/escapes the vault/);
  });
});
