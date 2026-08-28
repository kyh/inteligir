// The phone's read model over the hosted vault: the tree listing, a note
// cache behind the NoteCache port, and wiki-link resolution — all behind the
// credential the sync runtime already treats as the one switch. No
// credential, no request.
//
// The TREE stays in memory on purpose, the same posture as the sync store:
// cold launch re-fetches it, because the resolver and the commit must be
// current before any read is pinned. Note BODIES ride the injected cache —
// memory by default (tests, and the bound below), the expo-file-system
// adapter in the app — keyed `(commit, path)`, immutable content, so a row
// never goes stale. The generation fence applies to a cache hit exactly as
// to a fetch: a disk read that lands after an unpair is still the old
// account's data.
//
// Resolution uses the vault's OWN resolver (`@repo/notes/knowledge/
// link-resolve`) over the tree's paths, so an ambiguous `[[Title]]` breaks
// the same way on every device. The alias tiers stay empty here, stated: an
// alias lives in a doc's frontmatter, which the phone does not hold — an
// alias-only link renders unresolved until that changes.

import { buildResolver, type TargetResolver } from "@repo/notes/knowledge/link-resolve";
import type { VaultTreeResponse } from "@repo/api/cloud/vault/vault-schema";
import type { DeviceCredential } from "../credential/credential-codec";
import { createCloudClient, describeCloudFailure, type CloudFetch } from "@repo/api/cloud/client";
import { createExternalStore, type ExternalStore } from "../lib/external-store";
import { createMemoryNoteCache, type CachedNote, type NoteCache } from "./note-cache";

/** The default (memory) cache's bound: a note re-fetches on a miss, and the
 *  commit in the key makes a stale entry unreachable after a refresh. */
const NOTE_CACHE_MAX = 100;

/** The pages a refresh will walk before refusing — a runaway guard, not a
 *  quota (500 entries per page). */
const MAX_TREE_PAGES = 40;

export type NotesTreeState =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ready"; commit: string; entries: VaultTreeResponse["entries"] }
  | { state: "empty"; message: string }
  | { state: "error"; message: string };

/** The ok arm IS a cached row — one shape, so the cache hit and the fetch
 *  cannot answer with different fields. */
export type NoteRead = ({ ok: true } & CachedNote) | { ok: false; message: string };

/**
 * A credential and WHY the store is being handed it — the composition root
 * knows which of its three calls this is, and reconstructing that here (by
 * keeping a second copy of the bearer to compare against) answers a question
 * the caller already answered.
 */
interface CredentialHandover {
  credential: DeviceCredential;
  /** `restored` is the boot read of a credential this device already had —
   *  the durable rows on disk are this same pairing's, and that launch is
   *  what the cache exists for. `paired` is a pairing that just completed:
   *  nothing on disk belongs to it. */
  source: "restored" | "paired";
}

export interface NotesStore {
  /** The pairing layer's switch, same contract as the sync runtime's. */
  setCredential(next: CredentialHandover | null): void;
  /** Fetch the whole tree (paged) and rebuild the resolver. */
  refresh(): Promise<void>;
  tree: ExternalStore<NotesTreeState>;
  readNote(path: string): Promise<NoteRead>;
  /** A wiki target's vault path over the LAST refreshed tree, or null. */
  resolveWiki(target: string): string | null;
}

export interface CreateNotesStoreArgs {
  cloudUrl: string;
  fetch?: CloudFetch;
  /** The note-body cache; absent = the bounded memory one. The app injects
   *  the expo-file-system adapter here, and only here. */
  cache?: NoteCache;
}

type Client = ReturnType<typeof createCloudClient>;

/** The cache is best-effort HERE, so no implementation has to re-derive the
 *  discipline: a refused write costs a re-fetch, and nothing else. */
function bestEffort(work: Promise<void>): void {
  void work.catch(() => undefined);
}

export function createNotesStore(args: CreateNotesStoreArgs): NotesStore {
  let client: Client | null = null;
  let resolver: TargetResolver | null = null;
  /** Which generation's refresh is in flight (-1 = none). Tied to the
   *  generation rather than a boolean so a re-pair's refresh is never
   *  blocked by the PREVIOUS pairing's stalled one. */
  let refreshingFor = -1;
  /** Bumped on EVERY credential change (set and clear alike); checked after
   *  every await, so a response from the previous pairing can never
   *  repopulate the new one's state — the same fence the sync runtime runs. */
  let generation = 0;
  const noteCache = args.cache ?? createMemoryNoteCache(NOTE_CACHE_MAX);
  const tree = createExternalStore<NotesTreeState>({ state: "idle" });

  return {
    setCredential(next) {
      generation += 1;
      // The in-memory view resets on EVERY change: a re-pair must not serve
      // the previous account's tree or resolver for even one render.
      resolver = null;
      tree.set({ state: "idle" });
      // The DURABLE rows survive exactly one transition — the boot restore of
      // the credential that wrote them. An unpair or a fresh pairing is a
      // change of hands, and at-rest rows must not outlive the pairing that
      // fetched them.
      if (next === null || next.source === "paired") {
        bestEffort(noteCache.clear());
      }
      if (next === null) {
        client = null;
        return;
      }
      const clientArgs: Parameters<typeof createCloudClient>[0] = {
        baseUrl: args.cloudUrl,
        credential: next.credential.credential,
      };
      if (args.fetch !== undefined) clientArgs.fetch = args.fetch;
      client = createCloudClient(clientArgs);
    },

    async refresh() {
      if (client === null || refreshingFor === generation) return;
      const startedAt = generation;
      refreshingFor = startedAt;
      if (tree.get().state === "idle") tree.set({ state: "loading" });
      try {
        const entries: VaultTreeResponse["entries"][number][] = [];
        let commit: string | undefined;
        let after: string | undefined;
        for (let page = 0; page < MAX_TREE_PAGES; page += 1) {
          const query: Parameters<Client["vaultTree"]>[0] = {};
          if (commit !== undefined) query.ref = commit;
          if (after !== undefined) query.after = after;
          const result = await client.vaultTree(query);
          if (generation !== startedAt) return;
          if (!result.ok) {
            // "No hosted vault" is a STATE, not an error: an unpaired-desktop
            // or BYO-remote account answers 404 forever, and an error banner
            // would send the user hunting for a fault.
            const noVault =
              result.failure.kind === "refused" && result.failure.code === "not-found";
            tree.set(
              noVault
                ? {
                    state: "empty",
                    message: "No hosted vault yet — sync a desktop to your account first.",
                  }
                : { state: "error", message: describeCloudFailure(result.failure) },
            );
            return;
          }
          commit = result.value.commit;
          entries.push(...result.value.entries);
          after = result.value.next ?? undefined;
          if (after === undefined) break;
        }
        if (commit === undefined) return;
        if (after !== undefined) {
          // The guard tripped with pages still unread: a partial listing
          // silently missing notes (and wiki targets) must not answer
          // "ready" — the Worker sibling states the same rule.
          tree.set({ state: "error", message: "This vault is too large for the notes list." });
          return;
        }
        resolver = buildResolver(entries.map((entry) => entry.path));
        tree.set({ state: "ready", commit, entries });
        // Rows keyed to older commits are unreachable from here on; a durable
        // cache reclaims their disk.
        bestEffort(noteCache.sweep(commit));
      } finally {
        if (refreshingFor === startedAt) refreshingFor = -1;
      }
    },

    tree,

    async readNote(path) {
      if (client === null) return { ok: false, message: "Not paired." };
      // Captured across the awaits below: the closure's `client` is nulled by
      // an unpair, and the generation fence decides what to do with the
      // answer — not a crash on a vanished client.
      const activeClient = client;
      const startedAt = generation;
      const current = tree.get();
      const commit = current.state === "ready" ? current.commit : undefined;

      // Only a read PINNED to the tree's commit touches the cache: an
      // unpinned read answers whatever HEAD is now, and a cached row keyed to
      // a moving target would serve yesterday's bytes as today's.
      if (commit !== undefined) {
        const cached = await noteCache.get(commit, path).catch(() => null);
        if (generation !== startedAt) return { ok: false, message: "Not paired." };
        if (cached !== null) {
          return { ok: true, ...cached };
        }
      }

      const query: Parameters<Client["vaultFile"]>[0] = { path };
      if (commit !== undefined) query.ref = commit;
      const result = await activeClient.vaultFile(query);
      if (generation !== startedAt) {
        return { ok: false, message: "Not paired." };
      }
      if (!result.ok) {
        return { ok: false, message: describeCloudFailure(result.failure) };
      }
      if (commit !== undefined) {
        bestEffort(noteCache.set({ commit, path, content: result.value.content }));
      }
      return {
        ok: true,
        path,
        commit: result.value.commit,
        content: result.value.content,
      };
    },

    resolveWiki(target) {
      return resolver === null ? null : resolver.resolveWiki(target);
    },
  };
}
