// ---------------------------------------------------------------------------
// KnowledgeManager — the host shell around core's pure KnowledgeIndex: reads
// the real vault, keeps the index fresh from vault change notifications, and
// broadcasts onKnowledgeUpdated after every refresh.
//
// Update flow: VaultManager's watcher already coalesces fs event bursts into
// one notification; the manager adds its own short debounce, then diffs the
// listing against recorded (mtime, size, ino) fingerprints so only added/changed
// docs are re-parsed and removed ones dropped — a save touches one file's
// extraction, not the vault. A root switch (or first use) rebuilds from
// scratch. Queries before any notification build lazily, so handlers never
// race boot ordering.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";

import { KnowledgeIndex } from "@repo/core/knowledge/knowledge-index";
import type {
  BacklinkEntry,
  ForwardLinkEntry,
  LinkGraph,
  SearchResult,
  TagCount,
  WikiTarget,
} from "@repo/core/knowledge/knowledge-index";

import { emitEvent } from "../events";
import { getVaultManager, type VaultManager } from "../vault/vault";

const REFRESH_DEBOUNCE_MS = 100;

// ino rides along because vault writes are atomic (write temp + rename): a
// swap always lands on a fresh inode, so even an exact (mtime, size)
// collision can't masquerade as "unchanged".
type Fingerprint = { mtimeMs: number; size: number; ino: number };

export class KnowledgeManager {
  private readonly index = new KnowledgeIndex();
  /** (mtime, size, ino) per indexed doc — the incremental-refresh diff basis. */
  private readonly fingerprints = new Map<string, Fingerprint>();
  private readonly otherPaths = new Set<string>();
  private builtRoot: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private revision = 0;

  constructor(
    private readonly getVault: () => VaultManager,
    private readonly onUpdated: (revision: number) => void,
  ) {}

  // ---- Queries (index reads; build lazily on first use) ----------------------

  backlinks(vaultPath: string): BacklinkEntry[] {
    this.ensureBuilt();
    return this.index.backlinks(vaultPath);
  }

  forwardLinks(vaultPath: string): ForwardLinkEntry[] {
    this.ensureBuilt();
    return this.index.forwardLinks(vaultPath);
  }

  graph(): LinkGraph {
    this.ensureBuilt();
    return this.index.graph();
  }

  search(query: string, limit?: number): SearchResult[] {
    this.ensureBuilt();
    return this.index.search(query, limit);
  }

  wikiTargets(): WikiTarget[] {
    this.ensureBuilt();
    return this.index.wikiTargets();
  }

  tags(): TagCount[] {
    this.ensureBuilt();
    return this.index.tags();
  }

  notesWithTag(tag: string): string[] {
    this.ensureBuilt();
    return this.index.notesWithTag(tag);
  }

  // ---- Refresh ----------------------------------------------------------------

  /** Debounced refresh — wired to vault change notifications. */
  scheduleRefresh(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.refresh();
    }, REFRESH_DEBOUNCE_MS);
  }

  /** Diff the vault listing against fingerprints and re-index what changed.
   * Emits onKnowledgeUpdated when anything did. */
  refresh(): void {
    const vault = this.getVault();
    const root = vault.getRoot();
    let changed = false;
    if (root !== this.builtRoot) {
      this.index.clear();
      this.fingerprints.clear();
      this.otherPaths.clear();
      this.builtRoot = root;
      changed = true;
    }

    const seen = new Set<string>();
    for (const entry of vault.list()) {
      seen.add(entry.path);
      if (entry.kind !== "doc") {
        if (!this.otherPaths.has(entry.path)) {
          this.otherPaths.add(entry.path);
          this.index.setOther(entry.path);
          changed = true;
        }
        continue;
      }
      const fingerprint = statFingerprint(path.join(root, entry.path));
      if (fingerprint === null) continue; // vanished mid-scan; next refresh drops it
      const prior = this.fingerprints.get(entry.path);
      if (
        prior &&
        prior.mtimeMs === fingerprint.mtimeMs &&
        prior.size === fingerprint.size &&
        prior.ino === fingerprint.ino
      ) {
        continue;
      }
      try {
        this.index.setDoc(entry.path, vault.readText(entry.path));
      } catch (err) {
        console.warn(`[knowledge] could not read ${entry.path}:`, err);
        continue;
      }
      this.fingerprints.set(entry.path, fingerprint);
      changed = true;
    }

    for (const known of this.fingerprints.keys()) {
      if (seen.has(known)) continue;
      this.fingerprints.delete(known);
      this.index.remove(known);
      changed = true;
    }
    for (const known of this.otherPaths) {
      if (seen.has(known)) continue;
      this.otherPaths.delete(known);
      this.index.remove(known);
      changed = true;
    }

    if (changed) {
      this.revision++;
      this.onUpdated(this.revision);
    }
  }

  /** Cancel any pending debounce (shutdown). */
  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private ensureBuilt(): void {
    if (this.builtRoot === null) this.refresh();
  }
}

function statFingerprint(absolute: string): Fingerprint | null {
  try {
    const stat = fs.statSync(absolute);
    return { mtimeMs: stat.mtimeMs, size: stat.size, ino: stat.ino };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Lazy singleton — mirrors getVaultManager(). The vault manager is looked up
// per refresh (not captured) so a logout/login vault reset is picked up
// transparently; a root switch is detected inside refresh().
// ---------------------------------------------------------------------------

let instance: KnowledgeManager | null = null;

export function getKnowledgeManager(): KnowledgeManager {
  if (!instance) {
    instance = new KnowledgeManager(getVaultManager, (revision) =>
      emitEvent("onKnowledgeUpdated", { revision }),
    );
  }
  return instance;
}

/** Cancel pending work at host dispose. */
export function disposeKnowledgeManager(): void {
  instance?.dispose();
  instance = null;
}
