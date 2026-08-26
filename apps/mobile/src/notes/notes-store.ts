// The phone's read model over the hosted vault: the tree listing, a bounded
// note cache, and wiki-link resolution — all behind the credential the sync
// runtime already treats as the one switch. No credential, no request.
//
// IN MEMORY for v1, the same posture as the sync store and for the same
// reason: cold launch re-fetches, and the stated durable swap is a
// filesystem cache keyed by `(commit, path)` — immutable content, so it can
// cache forever — behind this same shape.
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

/** Cached note bodies. Small and bounded: a note re-fetches on a miss, and
 *  the commit in the key makes a stale entry unreachable after a refresh. */
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

export type NoteRead =
  | { ok: true; path: string; commit: string; content: string }
  | { ok: false; message: string };

export interface NotesStore {
  /** The pairing layer's switch, same contract as the sync runtime's. */
  setCredential(next: DeviceCredential | null): void;
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
}

type Client = ReturnType<typeof createCloudClient>;

export function createNotesStore(args: CreateNotesStoreArgs): NotesStore {
  let client: Client | null = null;
  let resolver: TargetResolver | null = null;
  let refreshing = false;
  const noteCache = new Map<string, NoteRead & { ok: true }>();
  const tree = createExternalStore<NotesTreeState>({ state: "idle" });

  return {
    setCredential(next) {
      if (next === null) {
        client = null;
        resolver = null;
        noteCache.clear();
        tree.set({ state: "idle" });
        return;
      }
      const clientArgs: Parameters<typeof createCloudClient>[0] = {
        baseUrl: args.cloudUrl,
        credential: next.credential,
      };
      if (args.fetch !== undefined) clientArgs.fetch = args.fetch;
      client = createCloudClient(clientArgs);
    },

    async refresh() {
      if (client === null || refreshing) return;
      refreshing = true;
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
      } finally {
        refreshing = false;
      }
    },

    tree,

    async readNote(path) {
      if (client === null) return { ok: false, message: "Not paired." };
      const current = tree.get();
      const commit = current.state === "ready" ? current.commit : undefined;
      const cacheKey = `${commit ?? "head"}:${path}`;
      const cached = noteCache.get(cacheKey);
      if (cached !== undefined) return cached;

      const query: Parameters<Client["vaultFile"]>[0] = { path };
      if (commit !== undefined) query.ref = commit;
      const result = await client.vaultFile(query);
      if (!result.ok) {
        return { ok: false, message: describeCloudFailure(result.failure) };
      }
      const read = {
        ok: true as const,
        path,
        commit: result.value.commit,
        content: result.value.content,
      };
      noteCache.set(cacheKey, read);
      // Bounded FIFO: the oldest key is the least likely to be re-read at the
      // current commit.
      while (noteCache.size > NOTE_CACHE_MAX) {
        const oldest = noteCache.keys().next().value;
        if (oldest === undefined) break;
        noteCache.delete(oldest);
      }
      return read;
    },

    resolveWiki(target) {
      return resolver === null ? null : resolver.resolveWiki(target);
    },
  };
}
