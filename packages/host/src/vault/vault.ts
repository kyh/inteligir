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
// wires a change notifier + starts the watcher at composition time; agent
// awareness is a stable `vault` symlink in the agent workspace (so the agent's
// native file tools always find the vault at ./vault regardless of where the
// user put it).
// ---------------------------------------------------------------------------

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import { AGENT_DIR, WORKSPACE_DIR } from "../agent/paths";
import { JsonStore, inteligirPath, type FsAdapter } from "../lib/json-store";
import type { VaultEntry } from "@repo/core/ipc-registry";

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
const DOC_EXTENSIONS = new Set([".md", ".markdown", ".mdx", ".txt"]);

function classify(filePath: string): VaultEntry["kind"] {
  return DOC_EXTENSIONS.has(path.extname(filePath).toLowerCase()) ? "doc" : "other";
}

const MAX_LIST_ENTRIES = 2000;
const SKIP_DIRS = new Set([".git", "node_modules", ".obsidian", ".trash"]);

type VaultManagerOptions = {
  fs?: FsAdapter;
  /** Override the settings file path (tests). */
  settingsPath?: string;
  /** Override the first-run default vault root (tests). */
  defaultRoot?: string;
  /** Maintain the `vault` symlink in the agent workspace. Off in tests so a
   * read/write against a temp dir never touches ~/.inteligir/workspace. */
  manageAgentLink?: boolean;
};

export class VaultManager {
  private readonly settings: JsonStore<VaultSettings>;
  private readonly defaultRoot: string;
  private readonly manageAgentLink: boolean;
  private watcher: fs.FSWatcher | null = null;
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;
  private changeNotifier: ((root: string) => void) | null = null;

  constructor(opts: VaultManagerOptions = {}) {
    this.defaultRoot = opts.defaultRoot ?? defaultVaultRoot();
    this.manageAgentLink = opts.manageAgentLink ?? true;
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
    this.restartWatcher();
    this.notify();
  }

  /** Create the vault dir + agent symlink. Called once at composition time. */
  ensureReady(): void {
    const root = this.getRoot();
    this.ensureRootDir(root);
    this.ensureAgentSymlink(root);
  }

  // ---- File operations ------------------------------------------------------

  /** List every file under the vault (relative paths), skipping dot/VCS dirs. */
  list(): VaultEntry[] {
    const root = this.getRoot();
    if (!fs.existsSync(root)) return [];
    const out: VaultEntry[] = [];
    const walk = (dir: string): void => {
      if (out.length >= MAX_LIST_ENTRIES) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
        // Skip the sibling temp files atomicWrite creates mid-save so they
        // never show up as real vault files.
        if (entry.isFile() && entry.name.endsWith(".tmp")) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile()) {
          if (out.length >= MAX_LIST_ENTRIES) return;
          const rel = path.relative(root, full).split(path.sep).join("/");
          out.push({ path: rel, name: entry.name, kind: classify(full) });
        }
      }
    };
    walk(root);
    return out.toSorted((a, b) => a.path.localeCompare(b.path));
  }

  /** Raw file text — what the editor panel reads/writes (JSON included). */
  readText(rel: string): string {
    const target = this.resolve(rel);
    return fs.readFileSync(target, "utf8");
  }

  writeText(rel: string, content: string): void {
    assertVaultWritable();
    const target = this.resolve(rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    atomicWrite(target, content);
  }

  delete(rel: string): boolean {
    assertVaultWritable();
    const target = this.resolve(rel);
    if (!fs.existsSync(target)) return false;
    fs.rmSync(target, { force: true });
    return true;
  }

  /** Rename/move a file within the vault. Both paths are confined under the
   * root; parent dirs of the destination are created. Refuses to overwrite an
   * existing destination so a rename can't silently clobber another note. */
  rename(from: string, to: string): { ok: true } | { ok: false; error: string } {
    assertVaultWritable();
    const src = this.resolve(from);
    const dst = this.resolve(to);
    if (!fs.existsSync(src)) return { ok: false, error: `Not found: ${from}` };
    if (src === dst) return { ok: true };
    if (fs.existsSync(dst)) return { ok: false, error: `${to} already exists` };
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.renameSync(src, dst);
    return { ok: true };
  }

  // ---- Watcher / notifier ---------------------------------------------------

  startWatching(notifier: (root: string) => void): void {
    this.changeNotifier = notifier;
    this.restartWatcher();
  }

  stopWatching(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.notifyTimer) {
      clearTimeout(this.notifyTimer);
      this.notifyTimer = null;
    }
  }

  /** Stop the watcher and disable the settings store before the dir is wiped. */
  close(): void {
    this.stopWatching();
    this.changeNotifier = null;
    this.settings.close();
  }

  // ---- Internals ------------------------------------------------------------

  // Lexical confinement: resolve the request against the root and require it to
  // stay inside. Rejects `..` traversal and absolute escapes ("/etc/passwd"
  // resolves outside root). Residual: a symlink planted inside the vault could
  // still point out, but the user owns the vault and the agent already has raw
  // fs access, so this guards the renderer path, not the agent.
  private resolve(rel: string): string {
    const root = path.resolve(this.getRoot());
    const target = path.resolve(root, rel);
    if (target !== root && !target.startsWith(root + path.sep)) {
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

  private restartWatcher(): void {
    this.stopWatching();
    if (!this.changeNotifier) return;
    const root = this.getRoot();
    if (!fs.existsSync(root)) return;
    const onEvent = (): void => this.scheduleNotify();
    try {
      this.watcher = fs.watch(root, { recursive: true }, onEvent);
    } catch {
      // Recursive watching is unsupported on some platforms (Linux) — fall back
      // to watching the root non-recursively. Better than nothing for an
      // experimental feature; nested edits still surface on the next list().
      try {
        this.watcher = fs.watch(root, onEvent);
      } catch (err) {
        console.warn("[vault] could not start watcher:", err);
      }
    }
  }

  // Coalesce the burst of fs events a single save produces into one broadcast.
  private scheduleNotify(): void {
    if (this.notifyTimer) clearTimeout(this.notifyTimer);
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      this.notify();
    }, 200);
  }

  private notify(): void {
    try {
      this.changeNotifier?.(this.getRoot());
    } catch (err) {
      console.warn("[vault] change notification failed:", err);
    }
  }
}

// Write to <path>.tmp then rename — atomic on POSIX + NTFS, so a crash
// mid-write leaves the previous file intact. Mirrors json-store's realFs.write
// but for arbitrary vault files (no mode restriction — user-owned data).
function atomicWrite(filePath: string, content: string): void {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, filePath);
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
// built on the next login re-attaches the watcher instead of going silent.
let sharedNotifier: ((root: string) => void) | null = null;
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
export function setVaultChangeNotifier(notifier: (root: string) => void): void {
  sharedNotifier = notifier;
  getVaultManager().startWatching(notifier);
}

export function resetVaultManager(): void {
  instance?.close();
  instance = null;
}
