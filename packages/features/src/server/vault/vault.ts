// ---------------------------------------------------------------------------
// VaultManager — the user's local knowledge vault: a single, user-selectable
// folder of markdown files that both the agent and the editor read and write
// (Obsidian-style). This is the app's *data* store, distinct from the app-state
// store under ~/.inteligir.
//
// Why not JsonStore: JsonStore owns a single file as the authoritative
// in-memory cache and quarantines-then-resets anything it can't parse. The
// vault is user-owned and edited out of band (their editor, git, Dropbox, the
// agent's own file tools), so reads go through to disk and a malformed file is
// surfaced as an error, never reset. We reuse JsonStore only for the small
// settings file that records WHERE the vault lives.
//
// Electron-free so it can be unit-tested with a temp dir. The main process
// wires a change notifier at composition time; agent awareness is a stable
// `vault` symlink in the agent workspace (so the agent's native file tools
// always find the vault at ./vault regardless of where the user put it).
//
// Liveness model (vault liveness — CLAUDE.md § Decisions): the listing is an
// EPHEMERAL, refreshable snapshot,
// not a watched mirror. There is NO recursive filesystem watcher. The snapshot
// refreshes on demand — app-initiated structural writes, window focus, the
// explicit "Refresh vault" command, and delegation completion. The ONLY watcher
// is a single non-recursive watch on the currently open note (watchOpenNote),
// so external edits to the file the user is looking at still reload; edits to
// other files surface on the next refresh.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ignore, { type Ignore } from "ignore";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import { AGENT_DIR, WORKSPACE_DIR } from "../agent/paths";
import { atomicWrite } from "../lib/atomic-write";
import { JsonStore, inteligirPath, type FsAdapter } from "../lib/json-store";
import { getPlatform } from "../platform-instance";
import { classifyFileChange, SelfSaveRegistry } from "./classify-file-change";
import { isDocPath } from "@repo/core/knowledge/doc-file";
import type { VaultEntry } from "@repo/features/ipc-registry";

// ---------------------------------------------------------------------------
// Settings store — records the vault location. Lives in ~/.inteligir so it is
// reset alongside the rest of app state on logout (the vault DATA, being
// external, survives; only the pointer reverts to the default).
// ---------------------------------------------------------------------------

const SETTINGS_VERSION = 1;

const SettingsFileSchema = Type.Object(
  { version: Type.Literal(SETTINGS_VERSION), vaultPath: Type.String() },
  { additionalProperties: false },
);

type VaultSettings = { vaultPath: string };

/** Default vault location — ~/Documents/Inteligir, created on first use. */
function defaultVaultRoot(): string {
  return path.join(os.homedir(), "Documents", "Inteligir");
}

// File-extension → entry kind. `doc` is editable markdown/text; everything else
// (images, pdfs, json, …) is `other` and shown but not opened in the editor.
// The extension set lives in core (knowledge/doc-file) so the knowledge index
// and the dev-harness fixture classify identically.
function classify(fileName: string): VaultEntry["kind"] {
  return isDocPath(fileName) ? "doc" : "other";
}

// Hard-pruned directories — never walked, never listed, regardless of ignore
// files. Cheap protection against the classic repo-shaped-vault blowups.
const SKIP_DIRS = new Set([".git", "node_modules", ".obsidian", ".trash"]);
// Root-level ignore files parsed (v1) to filter DISCOVERY (not access). A file
// the user explicitly opens outside the snapshot still reads/writes fine.
const IGNORE_FILES = [".gitignore", ".ignore"];

/** How a vault change should propagate. `refresh` runs the full pipeline
 * (broadcast onVaultChanged + knowledge + sync) — structural writes, the open-
 * note watcher, focus/manual refresh, delegation completion. `save` is a
 * content overwrite of an existing file (an autosave): it keeps the knowledge
 * index and sync live but does NOT broadcast, so the user's own typing stops
 * generating any vault-changed traffic (vault liveness — CLAUDE.md
 * § Decisions). */
export type VaultChangeKind = "refresh" | "save";

/** A listed vault file with its stat identity — what one crawl+stat pass
 * yields, shared by the sidebar listing, knowledge reconcile, and sync. */
export type VaultStatEntry = {
  path: string;
  name: string;
  kind: VaultEntry["kind"];
  mtimeMs: number;
  size: number;
  ino: number;
};

/** How long a walk+stat snapshot may be reused. Bounds staleness for sync's
 * snapshot-served fingerprints; a refresh burst (window focus fans into
 * renderer listing + knowledge + sync) shares ONE crawl inside the window. */
const SNAPSHOT_TTL_MS = 1000;

type VaultSnapshot = {
  at: number;
  root: string;
  entries: VaultStatEntry[];
  byPath: Map<string, VaultStatEntry>;
};

type VaultManagerOptions = {
  fs?: FsAdapter;
  /** Override the settings file path (tests). */
  settingsPath?: string;
  /** Override the first-run default vault root (tests). */
  defaultRoot?: string;
  /** Maintain the `vault` symlink in the agent workspace. Off in tests so a
   * read/write against a temp dir never touches ~/.inteligir/workspace. */
  manageAgentLink?: boolean;
  /** Move an absolute path to the OS trash (tests inject fakes). Defaults
   * LAZILY at call time to the platform capability (secrets.ts cipher
   * precedent) so unit tests that never call trash() need no platform. */
  trashItem?: (absolutePath: string) => Promise<void>;
};

export class VaultManager {
  private readonly settings: JsonStore<VaultSettings>;
  private readonly defaultRoot: string;
  private readonly manageAgentLink: boolean;
  private readonly trashItem: ((absolutePath: string) => Promise<void>) | undefined;
  private changeNotifier: ((root: string, kind: VaultChangeKind) => void) | null = null;
  // The single non-recursive watcher on the open note (vault liveness —
  // CLAUDE.md § Decisions). Everything
  // else is refreshed on demand, so there is no recursive root watcher.
  private openWatcher: fs.FSWatcher | null = null;
  private watchedPath: string | null = null;
  // Fingerprint of the watched note last time we observed it — the classifier's
  // baseline for deciding reload vs. no-op.
  private watchedFingerprint: string | null = null;
  private readonly selfSaves = new SelfSaveRegistry();
  // TTL-cached walk+stat snapshot backing list()/listAllPaths()/listWithStats()
  // and (when fresh) statFingerprint. Invalidated by every mutating method and
  // by refresh(); external edits surface on the next refresh trigger — the
  // ephemeral-liveness contract (CLAUDE.md § Decisions) unchanged, just
  // deduplicated.
  private snapshot: VaultSnapshot | null = null;

  constructor(opts: VaultManagerOptions = {}) {
    this.defaultRoot = opts.defaultRoot ?? defaultVaultRoot();
    this.manageAgentLink = opts.manageAgentLink ?? true;
    this.trashItem = opts.trashItem;
    this.settings = new JsonStore<VaultSettings>(
      opts.settingsPath ?? inteligirPath("settings.json"),
      SettingsFileSchema,
      { vaultPath: this.defaultRoot },
      {
        fs: opts.fs,
        versioning: {
          current: SETTINGS_VERSION,
          // No unversioned era — settings.json is new. Treat any such file as
          // corrupt rather than guessing its shape.
          fromLegacy: () => {
            throw new Error("settings.json has no version field");
          },
        },
        decode: (raw) => {
          if (!Value.Check(SettingsFileSchema, raw)) throw new Error("settings shape rejected");
          return { vaultPath: raw.vaultPath };
        },
        encode: (value) => ({ version: SETTINGS_VERSION, vaultPath: value.vaultPath }),
      },
    );
  }

  // ---- Root / settings ------------------------------------------------------

  getRoot(): string {
    const stored = this.settings.read().vaultPath;
    return stored.length > 0 ? stored : this.defaultRoot;
  }

  /** Repoint the vault at a new folder, (re)create it, refresh the agent
   * symlink + watcher, and notify subscribers so the sidebar + editor reload.
   * Rejects a root inside ~/.inteligir — that directory is wiped on logout,
   * which would silently destroy the user's "persistent" data. */
  setRoot(root: string): void {
    assertVaultWritable();
    const resolved = path.resolve(root);
    // Resolve symlinks before the guard: a folder that *links* into ~/.inteligir
    // would otherwise pass a lexical check while its files live where logout
    // wipes them. realPath falls back to the lexical path when it doesn't exist
    // yet (a fresh folder can't be a symlink into anything).
    const realResolved = realPath(resolved);
    const agentDir = realPath(AGENT_DIR);
    if (realResolved === agentDir || realResolved.startsWith(agentDir + path.sep)) {
      throw new Error(
        "Choose a folder outside the app data directory (~/.inteligir) — anything there is deleted on logout.",
      );
    }
    // Create the dir first and let failure propagate, so we don't persist a
    // vault path we couldn't actually set up (the IPC caller surfaces the throw
    // as an error to the user). The symlink stays best-effort — the agent's
    // ./vault convenience link failing shouldn't block using the vault.
    fs.mkdirSync(resolved, { recursive: true });
    this.settings.update((s) => ({ ...s, vaultPath: resolved }));
    this.ensureAgentSymlink(resolved);
    this.invalidateSnapshot();
    // The open note belonged to the old vault — stop watching it; the renderer
    // drops the note and re-points the watcher after the switch.
    this.watchOpenNote(null);
    this.notify("refresh");
  }

  /** Create the vault dir + agent symlink. Called once at composition time. */
  ensureReady(): void {
    const root = this.getRoot();
    this.ensureRootDir(root);
    this.ensureAgentSymlink(root);
  }

  // ---- File operations ------------------------------------------------------

  /** List every file under the vault (relative paths), respecting SKIP_DIRS and
   * the root ignore files. Uncapped: the crawl is now on-demand (ephemeral
   * snapshot — vault liveness, CLAUDE.md § Decisions), not
   * per-filesystem-event, so there is no scaling
   * hazard to cap against. Drives the sidebar file tree. Served from the
   * shared TTL snapshot so a refresh burst crawls once. */
  list(): VaultEntry[] {
    return this.getSnapshot().map((e) => ({ path: e.path, name: e.name, kind: e.kind }));
  }

  /** Every file path under the vault (same crawl as list(), minus the entry
   * shaping). Sync must see every NON-ignored file — a truncated manifest reads
   * as deletions: the 3-way reconcile treats "was in base and
   * remote, missing from local" as a local deletion and propagates it to the
   * coordinator and every peer. Ignore rules filter what sync tracks by design;
   * SKIP_DIRS + ignore files are the only exclusions, and they match list(). */
  listAllPaths(): string[] {
    return this.getSnapshot().map((e) => e.path);
  }

  /** The listing WITH stat identities — the knowledge reconcile's one-crawl
   * diff basis. Freshness follows the snapshot TTL: external edits surface on
   * the next refresh trigger, exactly the ephemeral-liveness contract. */
  listWithStats(): VaultStatEntry[] {
    return [...this.getSnapshot()];
  }

  // The shared crawl behind list()/listAllPaths()/listWithStats(): one walk +
  // one stat per file, cached for SNAPSHOT_TTL_MS and invalidated by every
  // mutating method (and rebuilt, never reused, by an explicit refresh()) —
  // so the window-focus fan-out (renderer listing, knowledge diff, sync
  // manifest+fingerprints) shares a single crawl instead of three.
  private getSnapshot(): VaultStatEntry[] {
    const root = this.getRoot();
    const cached = this.snapshot;
    if (cached && cached.root === root && Date.now() - cached.at <= SNAPSHOT_TTL_MS) {
      return cached.entries;
    }
    if (!fs.existsSync(root)) {
      this.snapshot = null;
      return [];
    }
    const entries: VaultStatEntry[] = [];
    const byPath = new Map<string, VaultStatEntry>();
    for (const file of this.walk(root)) {
      let stat: fs.Stats;
      try {
        stat = fs.statSync(path.join(root, file.path));
      } catch {
        continue; // vanished mid-crawl — the next refresh settles it
      }
      const entry: VaultStatEntry = {
        path: file.path,
        name: file.name,
        kind: classify(file.name),
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        ino: stat.ino,
      };
      entries.push(entry);
      byPath.set(file.path, entry);
    }
    entries.sort((a, b) => a.path.localeCompare(b.path));
    this.snapshot = { at: Date.now(), root, entries, byPath };
    return entries;
  }

  private invalidateSnapshot(): void {
    this.snapshot = null;
  }

  // Shared recursive walk backing both list() and listAllPaths(): skips
  // dot-entries, SKIP_DIRS, ignore-matched paths, and the sibling *.tmp files
  // atomicWrite creates mid-save. Returns entries in directory-read order
  // (unsorted — callers sort).
  private walk(root: string): { path: string; name: string }[] {
    const out: { path: string; name: string }[] = [];
    const ig = this.loadIgnore(root);
    const visit = (dir: string): void => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
        if (entry.isFile() && entry.name.endsWith(".tmp")) continue;
        const full = path.join(dir, entry.name);
        const rel = path.relative(root, full).split(path.sep).join("/");
        // `ignore` wants a trailing slash to match directory patterns.
        if (entry.isDirectory()) {
          if (ig !== null && ig.ignores(`${rel}/`)) continue;
          visit(full);
        } else if (entry.isFile()) {
          if (ig !== null && ig.ignores(rel)) continue;
          out.push({ path: rel, name: entry.name });
        }
      }
    };
    visit(root);
    return out;
  }

  // Parse the root ignore files (.gitignore / .ignore) into a matcher, or null
  // when none exist. v1: root-level only — nested ignore files aren't merged.
  // Rebuilt per crawl (crawls are on-demand now, so this is cheap and always
  // reflects the current ignore files).
  private loadIgnore(root: string): Ignore | null {
    let matcher: Ignore | null = null;
    for (const name of IGNORE_FILES) {
      let text: string;
      try {
        text = fs.readFileSync(path.join(root, name), "utf8");
      } catch {
        continue; // absent or unreadable — skip
      }
      matcher ??= ignore();
      matcher.add(text);
    }
    return matcher;
  }

  /** Raw file text — what the editor panel reads/writes (JSON included). */
  readText(rel: string): string {
    const target = this.resolve(rel);
    return fs.readFileSync(target, "utf8");
  }

  writeText(rel: string, content: string): void {
    assertVaultWritable();
    const target = this.resolve(rel);
    const existed = fs.existsSync(target);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    atomicWrite(target, content);
    this.invalidateSnapshot();
    // A new file changes the listing (refresh); overwriting an existing one is a
    // content save (sync + knowledge stay live, but no broadcast — the open-note
    // watcher covers the open file, and the app's own autosaves go silent).
    this.notify(existed ? "save" : "refresh");
  }

  /** Record that the app itself just wrote `rel` (the editor's autosave path),
   * so the watch event that write triggers on the open note is filtered out
   * rather than mistaken for an external edit. Called by the editor write
   * handler only — restore / sync-pull deliberately do NOT record, so their
   * writes to the open note still surface as reloads. */
  markSelfSave(rel: string): void {
    try {
      const stat = fs.statSync(this.resolve(rel));
      this.selfSaves.record(rel, stat.mtimeMs);
    } catch {
      // Path escaped the vault or vanished — nothing to record.
    }
  }

  /** Raw file bytes — the binary-safe primitive the sync protocol reads (markdown
   * is UTF-8, but images/pdfs are opaque bytes a text round-trip would corrupt).
   * A fresh `Uint8Array` copy so callers can't mutate node's internal buffer. */
  readBytes(rel: string): Uint8Array {
    const target = this.resolve(rel);
    return new Uint8Array(fs.readFileSync(target));
  }

  /** Atomically write raw bytes — the binary-safe write the sync client uses to
   * land a pulled file. Same confinement + atomic-rename story as writeText. */
  writeBytes(rel: string, content: Uint8Array): void {
    assertVaultWritable();
    const target = this.resolve(rel);
    const existed = fs.existsSync(target);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    atomicWrite(target, content);
    this.invalidateSnapshot();
    this.notify(existed ? "save" : "refresh");
  }

  /** Cheap stat-keyed change-detection fingerprint for the sync engine's hash
   * cache — `mtimeMs:size:ino`, or `null` on any error (missing file, etc.).
   * A change to content necessarily changes at least one of these, so a matching
   * fingerprint safely licenses reusing a cached hash instead of re-reading.
   * Served from the shared snapshot when fresh (so a sync pass adds no second
   * stat sweep, ≤SNAPSHOT_TTL_MS stale — own writes always invalidate); a path
   * ABSENT from the snapshot (ignored files opened directly, non-listing
   * spellings) falls through to a live stat, never to a false null. */
  statFingerprint(rel: string): string | null {
    const cached = this.snapshot;
    if (cached && cached.root === this.getRoot() && Date.now() - cached.at <= SNAPSHOT_TTL_MS) {
      const entry = cached.byPath.get(rel);
      if (entry) return `${entry.mtimeMs}:${entry.size}:${entry.ino}`;
    }
    return this.liveStatFingerprint(rel);
  }

  // The uncached stat — confined through `resolve()` exactly like every other
  // file op. The open-note watcher baselines through THIS (freshness matters
  // for classify; it is one file, not a sweep).
  private liveStatFingerprint(rel: string): string | null {
    try {
      const stat = fs.statSync(this.resolve(rel));
      return `${stat.mtimeMs}:${stat.size}:${stat.ino}`;
    } catch {
      return null;
    }
  }

  /** Permanent remove. This is the SYNC path only (a sync-applied remote
   * delete was user-initiated — and trashed — on the ORIGINATING device, and
   * core's SyncIo.remove is synchronous); user-initiated deletes go through
   * trash() instead. */
  delete(rel: string): boolean {
    assertVaultWritable();
    const target = this.resolve(rel);
    if (!fs.existsSync(target)) return false;
    fs.rmSync(target, { force: true });
    this.invalidateSnapshot();
    this.notify("refresh");
    return true;
  }

  /** User-initiated delete: move the file to the OS trash so it's recoverable
   * (the OS is the trash UI — no in-app trash view). Falls back to a
   * permanent remove when the platform can't trash (some Linux setups),
   * matching the old behavior there. Non-recursive by contract, like
   * delete(): the UI offers Delete on files only, and shell.trashItem
   * accepting a directory must not silently widen that affordance. */
  async trash(rel: string): Promise<boolean> {
    assertVaultWritable();
    const target = this.resolve(rel);
    if (!fs.existsSync(target)) return false;
    const trashItem = this.trashItem ?? getPlatform().trashItem;
    try {
      await trashItem(target);
    } catch {
      fs.rmSync(target, { force: true });
    }
    this.invalidateSnapshot();
    this.notify("refresh");
    return true;
  }

  /** Rename/move a file within the vault. Both paths are confined under the
   * root; parent dirs of the destination are created. Refuses to overwrite an
   * existing destination so a rename can't silently clobber another note.
   *
   * The occupied check is CASE-INSENSITIVE (and unicode-normalization-
   * insensitive) over the destination directory's real listing: a plain
   * existsSync(dst) passes on case-sensitive dev filesystems and then
   * explodes on the APFS/NTFS machines the vault syncs to — and on APFS it
   * refused CASE-ONLY self-renames because existsSync(dst) saw the source
   * itself. Occupancy is decided by inode: a matching name that IS the
   * source (case-only / normalization-only retitle) passes through to a
   * direct fs.renameSync, which handles that atomically on APFS and NTFS. */
  rename(from: string, to: string): { ok: true } | { ok: false; error: string } {
    assertVaultWritable();
    const src = this.resolve(from);
    const dst = this.resolve(to);
    if (!fs.existsSync(src)) return { ok: false, error: `Not found: ${from}` };
    if (src === dst) return { ok: true };
    const dstDir = path.dirname(dst);
    // A not-yet-existing destination directory is trivially unoccupied
    // (mkdirSync below creates it).
    if (fs.existsSync(dstDir)) {
      const wanted = path.basename(dst).normalize("NFC").toLowerCase();
      let srcIno: number | null = null;
      try {
        srcIno = fs.statSync(src).ino;
      } catch {
        srcIno = null; // raced away — any name match below refuses, the safe side
      }
      let names: string[] = [];
      try {
        names = fs.readdirSync(dstDir);
      } catch {
        names = []; // unreadable dir — fall through; renameSync reports the real error
      }
      for (const name of names) {
        if (name.normalize("NFC").toLowerCase() !== wanted) continue;
        let ino: number | null = null;
        try {
          ino = fs.statSync(path.join(dstDir, name)).ino;
        } catch {
          continue; // vanished mid-scan — not an occupant
        }
        if (srcIno !== null && ino === srcIno) continue; // the source itself
        return { ok: false, error: `${to} already exists` };
      }
    }
    fs.mkdirSync(dstDir, { recursive: true });
    fs.renameSync(src, dst);
    this.invalidateSnapshot();
    this.notify("refresh");
    return { ok: true };
  }

  // ---- Change notifier / open-note watcher ----------------------------------

  /** Register the change notifier. Unlike the old recursive model this does NOT
   * start any filesystem watcher — app writes fire the notifier directly and
   * the open-note watcher is armed separately via watchOpenNote. */
  startWatching(notifier: (root: string, kind: VaultChangeKind) => void): void {
    this.changeNotifier = notifier;
  }

  /** Point the single non-recursive watcher at `rel` (the currently open note),
   * or clear it with `null`. Its events run the change classifier: a genuine
   * external edit (not one of our own autosaves) broadcasts onVaultChanged, so
   * the renderer's existing reload/vanish machinery reacts; self-saves and
   * no-op events are filtered. Edits to any OTHER file are invisible until the
   * next refresh — that is the whole point of the ephemeral model (vault
   * liveness — CLAUDE.md § Decisions).
   *
   * We watch the note's PARENT directory (non-recursive) filtered to its
   * basename, NOT the file path directly: a single-file watch is unreliable
   * across atomic-rename replacement (our own atomicWrite, and the way many
   * editors save), whereas a directory watch reliably reports in-place writes,
   * atomic renames, and deletes of the file by name. Still one note, still
   * non-recursive — the directory is not descended. */
  watchOpenNote(rel: string | null): void {
    this.closeOpenWatcher();
    if (rel === null || rel === "") return;
    let target: string;
    try {
      target = this.resolve(rel);
    } catch {
      return; // escapes the vault — nothing to watch
    }
    const dir = path.dirname(target);
    const base = path.basename(target);
    if (!fs.existsSync(dir)) return;
    this.watchedPath = rel;
    this.watchedFingerprint = this.liveStatFingerprint(rel);
    try {
      this.openWatcher = fs.watch(dir, (_event, filename) => {
        // A directory watch fires for every sibling; act only on the open note.
        // `filename` is null on some platforms — fall through and let the
        // fingerprint check decide.
        if (filename !== null && filename !== base) return;
        this.onOpenNoteEvent(rel, target);
      });
    } catch (err) {
      console.warn("[vault] could not watch open note:", err);
      this.watchedPath = null;
      this.watchedFingerprint = null;
    }
  }

  /** Fire the full refresh pipeline on demand (window focus, the "Refresh vault"
   * command, delegation completion). This is the ephemeral snapshot's rebuild
   * trigger — the renderer re-lists, knowledge re-indexes, sync kicks — and it
   * always drops the walk snapshot first, so the whole burst shares one FRESH
   * crawl (a refresh must discover external edits, never reuse the cache). */
  refresh(): void {
    this.invalidateSnapshot();
    this.notify("refresh");
  }

  stopWatching(): void {
    this.closeOpenWatcher();
  }

  /** Stop watching and disable the settings store before the dir is wiped. */
  close(): void {
    this.stopWatching();
    this.changeNotifier = null;
    this.settings.close();
  }

  // ---- Internals ------------------------------------------------------------

  // Confinement in two layers, both required to land inside the vault:
  //  (1) Lexical: resolve the request against the root and require it to stay
  //      inside. Rejects `..` traversal and absolute escapes ("/etc/passwd"
  //      resolves outside root).
  //  (2) Symlink-safe: realpath the target — dereferencing any symlink planted
  //      inside the vault by git/Dropbox/another tool — and re-verify it still
  //      lands inside the realpath'd root. This closes the residual where a
  //      link under the vault points out, guarding every renderer/IPC file op.
  //      (The agent keeps raw fs access by design; that surface is unconfined.)
  //      realPath resolves the nearest existing ancestor and rejoins the
  //      not-yet-created remainder, so a write that creates a new file still
  //      passes. One realpathSync per op — acceptable; no caching.
  private resolve(rel: string): string {
    const root = path.resolve(this.getRoot());
    const target = path.resolve(root, rel);
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new Error(`Path escapes the vault: ${rel}`);
    }
    const realRoot = realPath(root);
    const realTarget = realPath(target);
    if (realTarget !== realRoot && !realTarget.startsWith(realRoot + path.sep)) {
      throw new Error(`Path escapes the vault: ${rel}`);
    }
    return target;
  }

  private ensureRootDir(root: string): void {
    try {
      fs.mkdirSync(root, { recursive: true });
    } catch (err) {
      console.warn(`[vault] could not create vault dir ${root}:`, err);
    }
  }

  // A stable `vault` symlink in the agent workspace so the agent's native file
  // tools reach the vault at ./vault no matter where the user put it. This is
  // the whole "the agent doesn't need a special tool" story — point pi at the
  // folder and let it read/write files.
  private ensureAgentSymlink(root: string): void {
    if (!this.manageAgentLink) return;
    const resolvedRoot = path.resolve(root);
    // Don't symlink the workspace into itself.
    if (resolvedRoot === path.resolve(WORKSPACE_DIR)) return;
    const link = path.join(WORKSPACE_DIR, "vault");
    try {
      fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
      const existing = fs.lstatSync(link, { throwIfNoEntry: false });
      if (existing) {
        // Only ever replace a symlink we manage — never clobber a real dir/file.
        if (!existing.isSymbolicLink()) {
          console.warn(`[vault] ${link} exists and is not a symlink — skipping`);
          return;
        }
        if (fs.readlinkSync(link) === resolvedRoot) return;
        fs.unlinkSync(link);
      }
      fs.symlinkSync(resolvedRoot, link, process.platform === "win32" ? "junction" : "dir");
    } catch (err) {
      console.warn("[vault] could not create agent vault symlink:", err);
    }
  }

  // An event on the open note fired. Decide from disk state whether the editor
  // must react: filter our own autosaves (self-save registry) and no-op events
  // (unchanged fingerprint via the classifier); a genuine external edit or a
  // vanish broadcasts so the renderer reloads/closes as it does today.
  private onOpenNoteEvent(rel: string, target: string): void {
    // Still the note we're meant to be watching? (watchOpenNote(null) closes the
    // watcher, but a queued event could still land.)
    if (this.watchedPath !== rel) return;
    let stat: fs.Stats | null;
    try {
      stat = fs.statSync(target);
    } catch {
      stat = null; // vanished/unreadable
    }
    if (stat === null) {
      // The open note disappeared — broadcast so the renderer's vanish watcher
      // closes it. Keep the directory watch running (and the last fingerprint)
      // so a recreate/rename-back is still caught; the renderer clears the
      // watcher via setWatchedNote(null) when it drops the note.
      this.notify("refresh");
      return;
    }
    // Our own autosave landing — never reload the editor onto what it just wrote.
    if (this.selfSaves.isSelfSave(rel, stat.mtimeMs)) return;
    const current = `${stat.mtimeMs}:${stat.size}:${stat.ino}`;
    const verdict = classifyFileChange({
      lastKnown: this.watchedFingerprint,
      current,
      // The host doesn't track the editor's dirty state; it broadcasts on any
      // external change and lets the renderer's externalChange resolve reload
      // vs. conflict (its behavior today). `reload` and `conflict` both
      // broadcast, so passing false here is safe and never suppresses.
      editorDirty: false,
    });
    // Advance the baseline so a duplicate event for the same state is a no-op.
    this.watchedFingerprint = current;
    if (verdict === "reload" || verdict === "conflict") this.notify("refresh");
  }

  private closeOpenWatcher(): void {
    if (this.openWatcher) {
      this.openWatcher.close();
      this.openWatcher = null;
    }
    if (this.watchedPath !== null) this.selfSaves.forget(this.watchedPath);
    this.watchedPath = null;
    this.watchedFingerprint = null;
  }

  private notify(kind: VaultChangeKind): void {
    try {
      this.changeNotifier?.(this.getRoot(), kind);
    } catch (err) {
      console.warn("[vault] change notification failed:", err);
    }
  }
}

/** Canonical path with symlinks resolved. For a path that doesn't exist yet,
 * resolve the nearest existing ancestor (so a symlinked *parent* is still
 * dereferenced) and rejoin the remaining segments — otherwise a not-yet-created
 * folder under a symlink into ~/.inteligir would slip past the guard. */
function realPath(p: string): string {
  const resolved = path.resolve(p);
  const tail: string[] = [];
  let current = resolved;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return resolved; // reached filesystem root, nothing exists
    tail.unshift(path.basename(current));
    current = parent;
  }
  try {
    const realBase = fs.realpathSync(current);
    return tail.length > 0 ? path.join(realBase, ...tail) : realBase;
  } catch {
    return resolved;
  }
}

// ---------------------------------------------------------------------------
// Lazy singleton — mirrors getTaskManager(). resetVaultManager() is called
// from teardownAgentResources() before ~/.inteligir is wiped so the watcher
// and settings store release before the dir disappears.
// ---------------------------------------------------------------------------

let instance: VaultManager | null = null;
// Module-scoped so it survives resetVaultManager() (logout): a fresh instance
// built on the next login re-attaches the notifier instead of going silent.
let sharedNotifier: ((root: string, kind: VaultChangeKind) => void) | null = null;
// Mirrors the shell's write suspension: between logout (teardown wipes
// ~/.inteligir, including settings.json) and the next login, a dirty autosave
// firing from a still-mounted panel must not lazily build a fresh manager with
// the DEFAULT root and write the user's edits to the wrong folder (recreating
// app data). Writes throw while suspended; reads stay allowed.
let writesSuspended = false;

function assertVaultWritable(): void {
  if (writesSuspended) throw new Error("Vault is signed out");
}

/** Suspend vault writes (logout). Called from teardownAgentResources. */
export function suspendVaultWrites(): void {
  writesSuspended = true;
}

/** Resume vault writes after a successful (re)login. */
export function resumeVaultWrites(): void {
  writesSuspended = false;
}

export function getVaultManager(): VaultManager {
  if (!instance) {
    instance = new VaultManager();
    if (sharedNotifier) instance.startWatching(sharedNotifier);
  }
  return instance;
}

/** Register the broadcast hookup once at composition time. Re-applied to every
 * instance created after a logout/login reset. */
export function setVaultChangeNotifier(
  notifier: (root: string, kind: VaultChangeKind) => void,
): void {
  sharedNotifier = notifier;
  getVaultManager().startWatching(notifier);
}

export function resetVaultManager(): void {
  instance?.close();
  instance = null;
}
