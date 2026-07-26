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
import { type Static, Type } from "@sinclair/typebox";

import { atomicWrite } from "@repo/storage/atomic-write";
import { JsonStore, inteligirPath, type FsAdapter } from "@repo/storage/json-store";
import { yieldToEventLoop } from "@repo/storage/yield-to-event-loop";
import { classifyFileChange, SelfSaveRegistry } from "./classify-file-change";
import { isDocPath } from "@repo/notes/knowledge/doc-file";
import type { VaultEntry } from "@repo/bridge/ipc-registry";

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

// Stored shape carries the version field; getters project it away.
type VaultSettings = Static<typeof SettingsFileSchema>;

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

/** A listed vault file as the WALK sees it: identity and kind straight off the
 * Dirent, no stat. This is everything the sidebar listing and the sync manifest
 * need, which is why the crawl never pays a stat to produce them. */
type VaultWalkEntry = { path: string; name: string; kind: VaultEntry["kind"] };

/** The stat triple change-detection diffs on. Content can't change without
 * moving at least one of these. */
type StatIdentity = { mtimeMs: number; size: number; ino: number };

/** A listed vault file as the knowledge reconcile sees it. Only `doc` entries
 * carry a stat identity — a doc's CONTENT is what gets re-projected when the
 * identity moves, while a non-doc is tracked by path alone, so stat-ing one is
 * a syscall nobody reads. Discriminated on `kind` so an unstat'd doc and a
 * stat'd non-doc are both unrepresentable. */
export type VaultListingEntry =
  | (VaultWalkEntry & { kind: "doc" } & StatIdentity)
  | (VaultWalkEntry & { kind: "other" });

/** How long a walk snapshot may be reused. Bounds staleness for sync's
 * snapshot-served fingerprints; a refresh burst (window focus fans into
 * renderer listing + knowledge + sync) shares ONE crawl inside the window. */
const SNAPSHOT_TTL_MS = 1000;

/** How long the stat sweep behind `listWithStats()` may run before yielding to
 * the event loop. Matches the knowledge pass's batch budget — short enough that
 * no single synchronous step grows with the vault. */
const STAT_SLICE_BUDGET_MS = 15;

type VaultSnapshot = {
  at: number;
  root: string;
  /** The crawl's files, keyed by vault-relative path, in sorted path order
   * (every listing serves that order straight off the iterator). Keyed rather
   * than an array because membership is a second question asked of the same
   * data: `statFingerprint` needs to know whether a path came out of the crawl
   * (already confined under the root) or has to go through the `resolve()`
   * funnel. */
  entries: Map<string, VaultWalkEntry>;
  /** Stat identities, filled LAZILY by `statOf` and memoized here — so a
   * refresh burst pays each file's stat at most once no matter how many
   * consumers ask, and files nobody asks about cost nothing. */
  stats: Map<string, StatIdentity>;
  /** Did the crawl observe the WHOLE vault? `false` when the root was missing
   * or any directory read failed — `entries` is then a best-effort partial.
   * The UI listing serves it anyway (lenient); `listAllPaths()` (the sync
   * manifest source) refuses it, because a truncated listing is
   * indistinguishable from a mass deletion. */
  complete: boolean;
};

/** Thrown by `listAllPaths()` when the crawl could not observe the whole vault
 * (missing root, an unreadable subtree). Sync-facing on purpose: the 3-way
 * reconcile reads "in base, absent from local" as a LOCAL DELETE, so a
 * truncated listing must fail the sync pass rather than propagate a vault-wide
 * deletion to every device. The UI-facing `list()`/`listWithStats()`
 * stay lenient and serve the partial instead. */
export class VaultListingIncompleteError extends Error {
  constructor(root: string) {
    super(
      `Vault listing incomplete — could not fully read ${root}; ` +
        "refusing to treat unread files as deleted. Check that the vault folder " +
        "is present and readable, then retry.",
    );
    this.name = "VaultListingIncompleteError";
  }
}

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
   * LAZILY at call time to the host-installed capability
   * (setVaultTrashItem — the workspaceLinkDir precedent) so unit tests that
   * never call trash() need no host composition. */
  trashItem?: (absolutePath: string) => Promise<void>;
  /** Directory that receives the `vault` symlink the agent's file tools
   * follow. Injected — the host composes it from the agent workspace at
   * construction (setVaultWorkspaceLinkDir in create-host); vault/ never
   * imports agent/*. Defaults LAZILY at call time to the module-scoped
   * shared value (trashItem precedent). */
  workspaceLinkDir?: string;
};

export class VaultManager {
  private readonly settings: JsonStore<VaultSettings>;
  private readonly defaultRoot: string;
  private readonly manageAgentLink: boolean;
  private readonly trashItem: ((absolutePath: string) => Promise<void>) | undefined;
  private readonly workspaceLinkDir: string | undefined;
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
  // TTL-cached walk snapshot backing list()/listAllPaths()/listWithStats() and
  // (when fresh) statFingerprint, plus the lazily-filled stat memo those last
  // two share. Invalidated by every mutating method and by refresh(); external
  // edits surface on the next refresh trigger — the ephemeral-liveness contract
  // (CLAUDE.md § Decisions) unchanged, just deduplicated.
  private snapshot: VaultSnapshot | null = null;

  constructor(opts: VaultManagerOptions = {}) {
    this.defaultRoot = opts.defaultRoot ?? defaultVaultRoot();
    this.manageAgentLink = opts.manageAgentLink ?? true;
    this.trashItem = opts.trashItem;
    this.workspaceLinkDir = opts.workspaceLinkDir;
    this.settings = new JsonStore<VaultSettings>(
      opts.settingsPath ?? inteligirPath("settings.json"),
      SettingsFileSchema,
      { version: SETTINGS_VERSION, vaultPath: this.defaultRoot },
      { fs: opts.fs, versioning: { current: SETTINGS_VERSION } },
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
    const agentDir = realPath(inteligirPath());
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
   * the root ignore files. Uncapped: the crawl is on-demand (ephemeral
   * snapshot — vault liveness, CLAUDE.md § Decisions), not
   * per-filesystem-event, so there is no scaling hazard to cap against.
   * Drives the sidebar file tree. Served from the shared TTL snapshot so a
   * refresh burst crawls once. */
  list(): VaultEntry[] {
    return Array.from(this.getSnapshot().entries.values(), (e) => ({
      path: e.path,
      name: e.name,
      kind: e.kind,
    }));
  }

  /** Every file path under the vault (same crawl as list(), minus the entry
   * shaping). Sync must see every NON-ignored file — a truncated manifest reads
   * as deletions: the 3-way reconcile treats "was in base and
   * remote, missing from local" as a local deletion and propagates it to the
   * coordinator and every peer. That is exactly why this — and ONLY this,
   * the sync-facing listing — THROWS on an incomplete crawl (missing root,
   * unreadable subtree) instead of returning the partial; the engine
   * surfaces the throw as a failed pass and retries later. Ignore rules
   * filter what sync tracks by design; SKIP_DIRS + ignore files are the only
   * exclusions, and they match list(). Nothing here stats, so a per-file stat
   * hiccup cannot silently thin this listing — only a failed readdir or a
   * missing root can, and both are refused above. */
  listAllPaths(): string[] {
    const snapshot = this.getSnapshot();
    if (!snapshot.complete) throw new VaultListingIncompleteError(snapshot.root);
    return Array.from(snapshot.entries.keys());
  }

  /** The listing WITH stat identities on the DOCS — the knowledge reconcile's
   * diff basis. Freshness follows the snapshot TTL: external edits surface on
   * the next refresh trigger, exactly the ephemeral-liveness contract.
   *
   * ASYNC because one stat per doc is the crawl's dominant syscall cost, and a
   * whole-vault sweep in one uninterruptible call is a multi-hundred-
   * millisecond stall on the host's only thread at 50k notes. The sweep runs in
   * `STAT_SLICE_BUDGET_MS` slices with event-loop yields between them
   * (SqlKnowledgeStore.hydrate's idiom), so no single synchronous step grows
   * with the vault. The result describes the vault as of the crawl this call
   * started on — a snapshot dropped mid-sweep still yields a coherent listing,
   * and the next refresh picks up whatever moved.
   *
   * Lenient like list(): a DOC that can't be stat'd is simply absent, because
   * derived knowledge self-heals on the next refresh. Non-docs never stat, so
   * nothing can thin them out of the listing — a flaky mount would otherwise
   * make the reconcile see an asset as deleted and re-add it every pass. Only
   * sync (`listAllPaths`) must refuse a partial, and it never stats at all. */
  async listWithStats(): Promise<VaultListingEntry[]> {
    // The slice clock starts BEFORE the walk: a cold call pays for its own
    // crawl, so charging that to the first slice makes the sweep yield right
    // after it rather than stacking a full slice on top of it.
    let sliceStart = Date.now();
    const snapshot = this.getSnapshot();
    const entries: VaultListingEntry[] = [];
    for (const entry of snapshot.entries.values()) {
      if (entry.kind === "doc") {
        const identity = this.statOf(snapshot, entry.path);
        if (identity !== null) entries.push({ ...entry, kind: "doc", ...identity });
      } else {
        entries.push({ ...entry, kind: "other" });
      }
      if (Date.now() - sliceStart >= STAT_SLICE_BUDGET_MS) {
        await yieldToEventLoop();
        sliceStart = Date.now();
      }
    }
    return entries;
  }

  // The shared crawl behind list()/listAllPaths()/listWithStats(): ONE walk,
  // cached for SNAPSHOT_TTL_MS and invalidated by every mutating method (and
  // rebuilt, never reused, by an explicit refresh()) — so the window-focus
  // fan-out (renderer listing, knowledge diff, sync manifest+fingerprints)
  // shares a single crawl instead of three.
  //
  // The crawl NEVER stats. Identity and kind come off the Dirent, which is
  // everything list()/listAllPaths() need, while a stat is a syscall per file —
  // the single largest cost in a large vault. Stats are filled in lazily by
  // statOf() for the two consumers that want them and memoized on the snapshot.
  //
  // A stat-free walk is what keeps the sync-facing listing honest, too: a file
  // readdir saw but stat cannot read (a flaky network mount) stays LISTED, so
  // it can never fall out of the manifest and be read as a deletion. Its
  // fingerprint goes null instead, which makes the engine re-read the bytes and
  // fail the pass loudly if those are unreadable too.
  private getSnapshot(): VaultSnapshot {
    const root = this.getRoot();
    const fresh = this.freshSnapshot(root);
    if (fresh !== null) return fresh;
    const entries = new Map<string, VaultWalkEntry>();
    // A missing root is an INCOMPLETE crawl, not an empty vault — it feeds the
    // completeness flag (listAllPaths throws; list serves the empty partial)
    // rather than silently reading as "every file was deleted".
    let complete = false;
    if (fs.existsSync(root)) {
      const walked = this.walk(root);
      complete = walked.complete;
      // Keyed AFTER the sort, so iteration order is the sorted order every
      // listing serves.
      walked.entries.sort((a, b) => a.path.localeCompare(b.path));
      for (const entry of walked.entries) entries.set(entry.path, entry);
    }
    const snapshot: VaultSnapshot = {
      at: Date.now(),
      root,
      entries,
      stats: new Map(),
      complete,
    };
    // Only COMPLETE crawls are cached: leniency may serve an incomplete
    // partial once, but the next call re-crawls — so recovery is immediate
    // and a cached failure can never satisfy a listAllPaths() retry after
    // the transient error has cleared.
    this.snapshot = complete ? snapshot : null;
    return snapshot;
  }

  // The cached snapshot when it is still serviceable — same root, inside the
  // TTL — else null. The root is a PARAMETER because getRoot() reads the
  // settings store: the caller that has already resolved it passes it in
  // instead of paying for it twice.
  private freshSnapshot(root: string): VaultSnapshot | null {
    const cached = this.snapshot;
    if (cached === null || cached.root !== root) return null;
    return Date.now() - cached.at <= SNAPSHOT_TTL_MS ? cached : null;
  }

  // The stat identity of a CRAWLED path, memoized onto its snapshot so every
  // consumer inside one TTL window shares the syscall. `null` when the file
  // can't be stat'd (vanished mid-crawl, a flaky mount) — the caller decides
  // what that means.
  //
  // Confinement comes from the crawl itself rather than resolve(): the walk
  // neither descends through nor emits a symlink (a Dirent reports a symlink as
  // neither isFile nor isDirectory), so every path in `entries` names a real
  // file under the real root.
  private statOf(snapshot: VaultSnapshot, rel: string): StatIdentity | null {
    const memo = snapshot.stats.get(rel);
    if (memo !== undefined) return memo;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(path.join(snapshot.root, rel));
    } catch {
      return null;
    }
    const identity: StatIdentity = { mtimeMs: stat.mtimeMs, size: stat.size, ino: stat.ino };
    snapshot.stats.set(rel, identity);
    return identity;
  }

  private invalidateSnapshot(): void {
    this.snapshot = null;
  }

  // The recursive walk behind the snapshot: skips dot-entries, SKIP_DIRS,
  // ignore-matched paths, and the sibling *.tmp files atomicWrite creates
  // mid-save. Returns entries in directory-read order (unsorted — the caller
  // sorts), plus whether every directory read succeeded: a failed readdir still
  // skips the subtree (list() stays lenient on the partial) but is RECORDED as
  // incompleteness instead of hidden, so listAllPaths() can refuse to present
  // the truncation as deletions.
  //
  // Each entry's vault-relative path is carried DOWN as a prefix and extended
  // by concatenation. Deriving it per entry with path.join + path.relative
  // instead costs several times every readdir syscall in the crawl combined
  // once a vault is large — the path math dominates this loop, not the
  // filesystem.
  private walk(root: string): { entries: VaultWalkEntry[]; complete: boolean } {
    const out: VaultWalkEntry[] = [];
    let complete = true;
    const ig = this.loadIgnore(root);
    const visit = (dir: string, prefix: string): void => {
      let dirents: fs.Dirent[];
      try {
        dirents = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        complete = false; // unreadable subtree — skip it, but never hide that
        return;
      }
      for (const dirent of dirents) {
        const name = dirent.name;
        if (name.startsWith(".") || SKIP_DIRS.has(name)) continue;
        const rel = prefix + name;
        // `ignore` wants a trailing slash to match directory patterns.
        if (dirent.isDirectory()) {
          if (ig !== null && ig.ignores(`${rel}/`)) continue;
          visit(childPath(dir, name), `${rel}/`);
        } else if (dirent.isFile()) {
          if (name.endsWith(".tmp")) continue;
          if (ig !== null && ig.ignores(rel)) continue;
          out.push({ path: rel, name, kind: classify(name) });
        }
      }
    };
    visit(root, "");
    return { entries: out, complete };
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
    // Full stat fingerprint (mtimeMs:size:ino), not mtime alone — an external
    // edit with a colliding mtime must still surface (classify-file-change).
    const fingerprint = this.liveStatFingerprint(rel);
    // Null = path escaped the vault or vanished — nothing to record.
    if (fingerprint !== null) this.selfSaves.record(rel, fingerprint);
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
   * Memoized on the shared snapshot when fresh (so a sync pass and a knowledge
   * pass in the same window stat each file once between them, ≤SNAPSHOT_TTL_MS
   * stale — own writes always invalidate); a path ABSENT from the crawl
   * (ignored files opened directly, non-listing spellings) falls through to a
   * resolve()-confined live stat, never to a false null. */
  statFingerprint(rel: string): string | null {
    const cached = this.freshSnapshot(this.getRoot());
    if (cached !== null && cached.entries.has(rel)) {
      const identity = this.statOf(cached, rel);
      return identity === null ? null : fingerprintOf(identity);
    }
    return this.liveStatFingerprint(rel);
  }

  // The uncached stat — confined through `resolve()` exactly like every other
  // file op. The open-note watcher baselines through THIS (freshness matters
  // for classify; it is one file, not a sweep).
  private liveStatFingerprint(rel: string): string | null {
    try {
      const stat = fs.statSync(this.resolve(rel));
      return fingerprintOf(stat);
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
    const trashItem = this.trashItem ?? requireSharedTrashItem();
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
    // Injected at composition (constructor option, else the module-scoped
    // value set by setVaultWorkspaceLinkDir) — resolved lazily at call time
    // like trashItem, so construction order doesn't matter.
    const workspaceDir = this.workspaceLinkDir ?? sharedWorkspaceLinkDir;
    if (workspaceDir === null) {
      console.warn("[vault] no workspace link dir configured — skipping agent symlink");
      return;
    }
    const resolvedRoot = path.resolve(root);
    // Don't symlink the workspace into itself.
    if (resolvedRoot === path.resolve(workspaceDir)) return;
    const link = path.join(workspaceDir, "vault");
    try {
      fs.mkdirSync(workspaceDir, { recursive: true });
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
    const current = fingerprintOf(stat);
    // Our own autosave landing — never reload the editor onto what it just
    // wrote. Compared on the FULL fingerprint: an external edit that collides
    // on mtime alone still differs in size/ino and must surface below.
    if (this.selfSaves.isSelfSave(rel, current)) return;
    const verdict = classifyFileChange({ lastKnown: this.watchedFingerprint, current });
    // Advance the baseline so a duplicate event for the same state is a no-op.
    this.watchedFingerprint = current;
    if (verdict === "reload") this.notify("refresh");
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

/** The change-detection fingerprint: `mtimeMs:size:ino`. One spelling, so the
 * open-note classifier, the sync hash cache and the snapshot memo can never
 * disagree about what "unchanged" means. */
function fingerprintOf(identity: StatIdentity): string {
  return `${identity.mtimeMs}:${identity.size}:${identity.ino}`;
}

/** `dir` extended by a single directory-entry name. A dirent name never
 * contains a separator, so plain concatenation is exactly path.join's result —
 * and path.join is a measurable per-entry cost across a whole vault. The
 * trailing-separator branch covers the one parent that can carry one: the
 * filesystem root. */
function childPath(dir: string, name: string): string {
  return dir.endsWith(path.sep) ? dir + name : dir + path.sep + name;
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
// The agent-workspace dir that receives the `vault` symlink. Injected by the
// host at composition (create-host) so vault/ never imports agent/*; module-
// scoped like sharedNotifier so it survives resetVaultManager().
let sharedWorkspaceLinkDir: string | null = null;
// The OS-trash capability (HostPlatform.trashItem). Injected by the host at
// composition (create-host) so vault/ never imports the platform seam;
// module-scoped like sharedWorkspaceLinkDir so it survives resetVaultManager().
let sharedTrashItem: ((absolutePath: string) => Promise<void>) | null = null;

function requireSharedTrashItem(): (absolutePath: string) => Promise<void> {
  if (!sharedTrashItem) {
    // Mirrors platform-instance's "not installed" throw: production installs
    // the capability in createHost() before any trash() can be reached.
    throw new Error("Vault trash capability not installed — createHost() has not run");
  }
  return sharedTrashItem;
}

/** Register the OS-trash capability once at composition time (the host passes
 * HostPlatform.trashItem; vault/ never imports the platform seam). */
export function setVaultTrashItem(trashItem: (absolutePath: string) => Promise<void>): void {
  sharedTrashItem = trashItem;
}
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

/** Register the agent-workspace symlink dir once at composition time (the
 * host passes the agent workspace; vault/ never imports agent/*). */
export function setVaultWorkspaceLinkDir(dir: string): void {
  sharedWorkspaceLinkDir = dir;
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
