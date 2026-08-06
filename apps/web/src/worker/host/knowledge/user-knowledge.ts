// ---------------------------------------------------------------------------
// UserKnowledge — the host shell around the pure knowledge engine, inside the
// user's own Durable Object: core's SQL KnowledgeStore over this object's
// SQLite (./do-sql-driver) mirrored into core's in-memory LinkGraphIndex, and
// `onKnowledgeUpdated` after every effective pass.
//
// It stands where the desktop's KnowledgeManager stood, and TWO of that
// design's load-bearing decisions invert here.
//
// PROJECTION IS A WRITE, not a diff. The desktop watched a folder it did not
// own, so it had to notice changes after the fact: crawl, stat, compare
// fingerprints, re-read, re-project. This object is the ONLY writer — every
// byte that reaches the vault passes through UserVault first — so a mutation
// hands the index the doc's text along with the hash it was stored under, and
// the projection happens at write time with no read of any kind. The
// fingerprint diff has nothing left to detect.
//
// HYDRATION IS THE NORMAL PATH, not a boot optimization. The object hibernates
// with its sockets open, so the in-memory graph is gone by the next message
// while the SQLite rows are exactly where they were. Every query therefore
// hydrates first, and hydration is PAGED (core's resumable cursor) with a yield
// between pages — a large vault must not turn one query into one uninterrupted
// synchronous read of the whole corpus.
//
// A reconcile SURVIVES both, and it is worth being precise about why, because
// write-time projection looks like it should retire it:
//
//   * the store is a wipe-and-rebuild CACHE. A schema or projection version
//     bump drops every row on purpose, and something has to rebuild them from
//     R2. That is not an error path; it is the documented upgrade path.
//   * write-time projection is best-effort by construction. A streamed upload
//     never held its bytes, a move carries none, and an R2 read can fail — all
//     three leave the index behind, and only a diff notices.
//
// What it is NOT is the desktop's stat sweep. The manifest already stores a
// sha-256 of every file's bytes, so the diff is an exact content comparison
// against the hash each projection recorded — no crawl, no stat heuristics, and
// zero reads when nothing moved. It runs once per wake (and on demand after a
// guarded write refuses), not per mutation.
// ---------------------------------------------------------------------------

import { isDocPath } from "@repo/notes/knowledge/doc-file";
import { SEARCH_DEFAULT_LIMIT, type SearchResult } from "@repo/notes/knowledge/knowledge-index";
import { buildResolver } from "@repo/notes/knowledge/link-resolve";
import {
  boundGraph,
  LinkGraphIndex,
  type BacklinkEntry,
  type BoundedLinkGraph,
  type ForwardLinkEntry,
  type GraphBounds,
  type VaultTaskEntry,
  type WikiTarget,
} from "@repo/notes/knowledge/link-graph-index";
import { projectDoc, type DocProjection } from "@repo/notes/knowledge/projection";
import { relatedNotes, type RelatedNoteEntry } from "@repo/notes/knowledge/related-notes";
import {
  createSqlKnowledgeStore,
  type SqlKnowledgeStore,
} from "@repo/notes/knowledge/sql-knowledge-store";
import type { TagCount } from "@repo/notes/knowledge/tag-index";
import { searchVaultNotes, type VaultSearchSources } from "@repo/notes/knowledge/vault-search";

import { sha256Hex } from "../../hash";
import {
  VAULT_ROOT,
  type ChangedBody,
  type UserVault,
  type VaultChange,
} from "../vault/user-vault";
import { createDoSqlDriver } from "./do-sql-driver";

/** Docs per hydration page. One page is one uninterrupted synchronous read, so
 * this is a latency bound rather than a throughput knob. */
const HYDRATION_PAGE_DOCS = 200;

/**
 * How many docs one pass may fetch from R2.
 *
 * The only work here that is neither free nor bounded by the vault's own write
 * rate: a rebuild reads every doc back, one subrequest each, against a Durable
 * Object's finite per-invocation budget. Over the cap the remainder stays
 * pending and the host's alarm brings the object back for another slice, so a
 * large vault finishes on its own rather than only as far as the user happens
 * to click.
 */
const MAX_BODY_READS_PER_PASS = 100;

/** R2 round trips dominate a rebuild, so they go out in parallel batches —
 * issuing them one at a time makes the build linear in latency, not in work. */
const READ_BATCH = 25;

/** How soon the host's alarm should return for the next build slice. Long
 * enough that a slice is not competing with live traffic, short enough that a
 * fresh vault is fully indexed within seconds of being written. */
export const INDEX_CONTINUATION_MS = 1_000;

/** A doc whose projection is out of date, with its bytes when a mutation
 * happened to have them (`null` means "read it back"). */
type StaleDoc = ChangedBody | null;

export type UserKnowledgeDeps = {
  readonly storage: DurableObjectStorage;
  readonly vault: UserVault;
  /** Fired after any pass that changed what a query would answer. The host
   * turns it into one `onKnowledgeUpdated` broadcast. */
  readonly onUpdated: () => void;
};

export class UserKnowledge {
  private readonly graph = new LinkGraphIndex();
  private readonly store: SqlKnowledgeStore;
  private readonly vault: UserVault;
  private readonly onUpdated: () => void;

  /** Content hash per indexed doc — always the hash of the bytes this index
   * actually projected, never merely the manifest's current one, so the
   * reconcile's comparison means "the file moved under me". */
  private readonly hashes = new Map<string, string>();
  private readonly others = new Set<string>();

  /** Paths waiting to be projected, and paths waiting to be dropped. Both are
   * drained by a pass; a path is never in both. */
  private readonly stale = new Map<string, StaleDoc>();
  private readonly dropped = new Set<string>();

  /** The in-memory mirrors reflect the persisted rows. False after every
   * hibernation, which is why hydration is not a boot-only concern. */
  private hydrated = false;
  /** The manifest has been diffed against the mirrors since this wake. */
  private reconciled = false;

  /** Serialized pass queue — hydration, reconcile and drain never interleave,
   * so no page can land on top of a fresher projection. */
  private queue: Promise<void> = Promise.resolve();

  constructor(deps: UserKnowledgeDeps) {
    this.vault = deps.vault;
    this.onUpdated = deps.onUpdated;
    // The root is a LABEL here (one vault per account), so the store's
    // moved-vault guard is satisfied by construction — it stays wired because
    // it is the same guard the desktop runs, not because it can trip.
    this.store = createSqlKnowledgeStore(createDoSqlDriver(deps.storage), VAULT_ROOT);
  }

  // ---- vault wiring ---------------------------------------------------------

  /** Record what a mutation changed. Synchronous and allocation-cheap: it runs
   * inside the vault's write path, which must not wait on an index. */
  record(change: VaultChange): void {
    for (const file of change.upserted) {
      this.dropped.delete(file.path);
      this.stale.set(file.path, file.body);
    }
    for (const path of change.removed) {
      this.stale.delete(path);
      this.dropped.add(path);
    }
  }

  /** Apply everything recorded. A no-op when nothing was, so an idle message
   * never pays for hydration the client did not ask for. */
  flush(): Promise<void> {
    return this.hasPendingWork() ? this.settle() : Promise.resolve();
  }

  /** Whether indexing work remains — the host folds this into its alarm so a
   * rebuild too large for one pass finishes without further traffic. */
  hasPendingWork(): boolean {
    return this.stale.size > 0 || this.dropped.size > 0;
  }

  /** Distrust the mirrors and re-diff against the manifest on the next pass.
   * The self-heal a guarded write's refusal kicks: the refusal proves the
   * projection the caller acted on no longer describes the file. */
  heal(): void {
    this.reconciled = false;
  }

  // ---- queries --------------------------------------------------------------

  async backlinks(path: string): Promise<BacklinkEntry[]> {
    await this.settle();
    return this.graph.backlinks(path);
  }

  async forwardLinks(path: string): Promise<ForwardLinkEntry[]> {
    await this.settle();
    return this.graph.forwardLinks(path);
  }

  /** Assembly is whole-vault (the index has no cheaper way to know the totals
   * it reports); the BOUND is what keeps the reply off the wire. */
  async linkGraph(bounds: GraphBounds): Promise<BoundedLinkGraph> {
    await this.settle();
    return boundGraph(this.graph.graph(), bounds);
  }

  async search(params: {
    query: string;
    tag?: string | undefined;
    limit?: number;
  }): Promise<SearchResult[]> {
    await this.settle();
    const sources: VaultSearchSources = {
      search: (text, max) => this.store.search(text, max),
      notesWithTag: (name) => this.graph.notesWithTag(name),
    };
    return searchVaultNotes(sources, {
      query: params.query,
      tag: params.tag,
      limit: params.limit ?? SEARCH_DEFAULT_LIMIT,
    });
  }

  async wikiTargets(): Promise<WikiTarget[]> {
    await this.settle();
    return this.graph.wikiTargets();
  }

  async tasks(): Promise<VaultTaskEntry[]> {
    await this.settle();
    return this.graph.tasks();
  }

  /** Every tag in the vault with how many notes carry it, most-used first. */
  async tags(): Promise<TagCount[]> {
    await this.settle();
    return this.graph.tags();
  }

  /** Notes connected to `path` indirectly — shared link targets, co-citation,
   * shared tags, similar wording — ranked, each with its reason. The lexical
   * leg runs through the persisted FTS5 index, so the blend is the same one
   * core's own composition produces. */
  async relatedNotes(path: string, limit?: number): Promise<RelatedNoteEntry[]> {
    await this.settle();
    return relatedNotes(
      this.graph,
      (query, max) => this.store.search(query, max),
      path,
      limit === undefined ? {} : { limit },
    );
  }

  /**
   * The docs a `from` → `to` rename may have to rewrite — a SUPERSET of the
   * ones that actually change, computed with no reads at all.
   *
   * Three populations, and only the first is what "who links here?" means:
   *
   *   1. the moved doc itself (self-links, and its own relative urls re-base
   *      when it changes directory);
   *   2. every doc holding a link that resolves to `from` today — the index's
   *      backlinks, exactly;
   *   3. every doc holding a link that would resolve to `to` AFTERWARDS. This
   *      is the shadow population, and it is why the answer is not just
   *      backlinks: a rename to `note.md` steals `[[note]]` from `a/note.md`,
   *      and those links have to be qualified to keep meaning what they meant.
   *      Only the renamed path changes, so a link whose resolution moves must
   *      land on `to` — which makes the post-rename resolver the exact test.
   *
   * Everything runs over the in-memory graph, so naming a candidate is free and
   * only the candidates are ever fetched.
   */
  async renameCandidates(from: string, to: string): Promise<string[]> {
    await this.settle();
    const candidates = new Set<string>([from]);
    for (const entry of this.graph.backlinks(from)) candidates.add(entry.sourcePath);

    const targets = this.graph.wikiTargets();
    const postPathOf = (path: string): string => (path === from ? to : path);
    const aliasEntries = targets.flatMap((target) =>
      (target.aliases ?? []).map((alias): readonly [string, string] => [
        alias,
        postPathOf(target.path),
      ]),
    );
    const postResolver = buildResolver(
      targets.map((target) => postPathOf(target.path)),
      aliasEntries,
    );

    for (const target of targets) {
      if (target.type !== "doc" || candidates.has(target.path)) continue;
      const sourcePost = postPathOf(target.path);
      for (const link of this.graph.forwardLinks(target.path)) {
        const hit =
          link.kind === "wiki"
            ? postResolver.resolveWiki(link.target)
            : postResolver.resolveMd(link.target, sourcePost);
        if (hit === to) {
          candidates.add(target.path);
          break;
        }
      }
    }
    return [...candidates];
  }

  // ---- passes ---------------------------------------------------------------

  /** Queue one pass and resolve when it (and everything queued ahead of it)
   * has run. Never rejects: an index failure is recovered from, not raised at
   * whoever happened to ask a question. */
  private settle(): Promise<void> {
    this.queue = this.queue.then(() => this.pass());
    return this.queue;
  }

  private async pass(): Promise<void> {
    try {
      if (!this.hydrated) await this.hydrateMirrors();
      if (!this.reconciled) {
        this.reconcile();
        this.reconciled = true;
      }
      if (await this.drain()) this.onUpdated();
    } catch (err) {
      console.warn("[knowledge] pass failed — rebuilding the index:", messageOf(err));
      this.recover();
    }
  }

  /** Replay the persisted projection into the in-memory mirrors, one bounded
   * page at a time with a yield between — a whole-corpus read in one call would
   * stall the isolate for every other request it is serving. */
  private async hydrateMirrors(): Promise<void> {
    const cursor = this.store.hydrate(HYDRATION_PAGE_DOCS);
    for (;;) {
      const page = cursor.next();
      if (page.kind === "done") break;
      if (page.kind === "docs") {
        for (const row of page.docs) {
          this.graph.applyDoc(row.path, row.projection);
          this.hashes.set(row.path, row.contentHash);
        }
      } else {
        for (const other of page.others) {
          this.graph.setOther(other.path);
          this.others.add(other.path);
        }
      }
      await yieldTurn();
    }
    this.hydrated = true;
  }

  /** Diff the manifest against what the mirrors hold. Pure comparison — the
   * work it finds is queued, never done here. */
  private reconcile(): void {
    const seen = new Set<string>();
    for (const file of this.vault.liveFiles()) {
      seen.add(file.path);
      const indexed = isDocPath(file.path)
        ? this.hashes.get(file.path) === file.contentHash
        : this.others.has(file.path);
      // Never clobber a recorded body with "read it back" — the bytes in hand
      // are the fresher fact.
      if (!indexed && !this.stale.has(file.path)) this.stale.set(file.path, null);
    }
    for (const path of this.hashes.keys()) if (!seen.has(path)) this.dropped.add(path);
    for (const path of this.others) if (!seen.has(path)) this.dropped.add(path);
  }

  /** Apply the queued removals and every projection whose bytes are already in
   * hand, then fetch as many of the rest as the read budget allows. Returns
   * whether a query would now answer differently.
   *
   * Each phase commits as ONE store transaction: this object's SQLite coalesces
   * a turn's writes into a single commit, and the per-row alternative would pay
   * for that machinery once per doc. */
  private async drain(): Promise<boolean> {
    const needBytes: string[] = [];
    let changed = this.dropped.size > 0;

    this.store.transaction(() => {
      for (const path of this.dropped) {
        this.store.remove(path);
        this.forget(path);
      }
      this.dropped.clear();

      // Snapshotted: the loop settles paths by deleting them as it goes.
      const pending = Array.from(this.stale);
      for (const [path, body] of pending) {
        const file = this.vault.lookup(path);
        if (file === null || file.state !== "live") {
          // Written and deleted before this pass ran: the manifest is the
          // authority, so as far as the index is concerned the write never
          // happened.
          this.stale.delete(path);
          this.forget(path);
          continue;
        }
        if (!isDocPath(path)) {
          this.stale.delete(path);
          this.store.upsertOther(path);
          this.graph.setOther(path);
          this.others.add(path);
          this.hashes.delete(path);
          changed = true;
          continue;
        }
        if (body === null || body.contentHash !== file.contentHash) {
          // No bytes, or bytes the manifest has moved past — fetch the truth.
          needBytes.push(path);
          continue;
        }
        this.stale.delete(path);
        this.project(path, body.text, body.contentHash);
        changed = true;
      }
    });

    const budgeted = needBytes.slice(0, MAX_BODY_READS_PER_PASS);
    for (let start = 0; start < budgeted.length; start += READ_BATCH) {
      const batch = budgeted.slice(start, start + READ_BATCH);
      const bodies = await Promise.all(batch.map((path) => this.readDoc(path)));
      this.store.transaction(() => {
        for (const [index, path] of batch.entries()) {
          const body = bodies[index];
          if (body === undefined || body === null) {
            // Unreadable: dropped rather than retried forever. The next
            // reconcile still finds no hash for it and tries again.
            this.stale.delete(path);
            continue;
          }
          // A write can land while the read is in flight. `readDoc` hashed the
          // bytes it actually got, so comparing that against the manifest is an
          // exact freshness test — and losing it leaves the path pending rather
          // than indexing bytes the vault has moved past.
          if (this.vault.lookup(path)?.contentHash !== body.contentHash) continue;
          this.stale.delete(path);
          this.project(path, body.text, body.contentHash);
          changed = true;
        }
      });
    }
    return changed;
  }

  /** Read a doc's bytes and hash exactly what was read, so the recorded hash
   * always describes the projected bytes even if the file moves mid-pass. */
  private async readDoc(path: string): Promise<ChangedBody | null> {
    try {
      const text = await this.vault.readText(path);
      return { text, contentHash: await sha256Hex(new TextEncoder().encode(text)) };
    } catch (err) {
      console.warn(`[knowledge] could not read ${path}:`, messageOf(err));
      return null;
    }
  }

  private project(path: string, text: string, contentHash: string): void {
    let projection: DocProjection;
    try {
      projection = projectDoc(path, text);
    } catch (err) {
      // A doc the parser chokes on stays unindexed rather than taking the pass
      // (and every other doc in it) down.
      console.warn(`[knowledge] could not index ${path}:`, messageOf(err));
      return;
    }
    this.store.upsertDoc(
      {
        path,
        // Inert here, and stored only because the row shape requires it: the
        // fingerprint exists for a host that must guess whether a file on a
        // filesystem changed. This one has the manifest's content hash, so it
        // never has to guess.
        fingerprint: { mtimeMs: 0, size: text.length, ino: 0 },
        contentHash,
        projection,
      },
      text,
    );
    this.graph.applyDoc(path, projection);
    this.hashes.set(path, contentHash);
    this.others.delete(path);
  }

  private forget(path: string): void {
    this.graph.remove(path);
    this.hashes.delete(path);
    this.others.delete(path);
  }

  /** Drop the cache and start over. Always safe — nothing durable lives in the
   * index — and the next pass rebuilds it from the manifest and R2. */
  private recover(): void {
    this.graph.clear();
    this.hashes.clear();
    this.others.clear();
    this.stale.clear();
    this.dropped.clear();
    try {
      this.store.nuke();
    } catch (err) {
      console.warn("[knowledge] index rebuild failed:", messageOf(err));
    }
    // Nothing left to hydrate; everything left to reconcile.
    this.hydrated = true;
    this.reconciled = false;
  }
}

/** Hand the runtime a turn between slices of a long sweep. */
function yieldTurn(): Promise<void> {
  return scheduler.wait(0);
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
