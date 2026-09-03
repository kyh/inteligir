import { buildResolver, type TargetResolver } from "@repo/notes/knowledge/link-resolve";
import type { VaultTreeResponse } from "@repo/api/cloud/vault/vault-schema";
import type { DeviceCredential } from "@repo/api/cloud/device/device-schema";
import {
  createCloudClient,
  describeCloudFailure,
  type CloudFetch,
  type VaultAssetSource,
} from "@repo/api/cloud/client";
import { createExternalStore, type ReadableStore } from "../lib/external-store";
import { createMemoryNoteCache, type CachedNote, type NoteCache } from "./note-cache";

const NOTE_CACHE_MAX = 100;

const MAX_TREE_PAGES = 40;

export type NotesTreeState =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ready"; commit: string; entries: VaultTreeResponse["entries"] }
  | { state: "empty"; message: string }
  | { state: "error"; message: string };

export type NoteRead = ({ ok: true } & CachedNote) | { ok: false; message: string };

export interface CredentialHandover {
  credential: DeviceCredential;
  // restored: the boot read of a credential whose cached rows are on disk. signed-in: nothing on
  // disk is this sign-in's.
  source: "restored" | "signed-in";
}

export interface NotesStore {
  setCredential(next: CredentialHandover | null): void;
  refresh(): Promise<void>;
  tree: ReadableStore<NotesTreeState>;
  readNote(path: string): Promise<NoteRead>;
  resolveWiki(target: string): string | null;
  // null until a tree is ready: the route refuses an unpinned asset url. the bytes then sit in the
  // platform image caches (NSURLCache, Fresco), which core RN Image cannot purge on sign-out.
  assetSource(path: string): VaultAssetSource | null;
}

export interface CreateNotesStoreArgs {
  cloudUrl: string;
  fetch?: CloudFetch;
  cache?: NoteCache;
}

type Client = ReturnType<typeof createCloudClient>;

function bestEffort(work: Promise<void>): void {
  void work.catch(() => undefined);
}

export function createNotesStore(args: CreateNotesStoreArgs): NotesStore {
  let client: Client | null = null;
  let resolver: TargetResolver | null = null;
  // a generation, not a boolean, so a new sign-in's refresh is never blocked by the previous sign-in's
  // stalled one.
  let refreshingFor = -1;
  // bumped on every credential change and checked after every await: a response from the previous
  // sign-in must not land.
  let generation = 0;
  const noteCache = args.cache ?? createMemoryNoteCache(NOTE_CACHE_MAX);
  const tree = createExternalStore<NotesTreeState>({ state: "idle" });
  const assetSources = new Map<string, VaultAssetSource>();

  return {
    setCredential(next) {
      generation += 1;
      resolver = null;
      assetSources.clear();
      tree.set({ state: "idle" });
      // durable rows survive only the boot restore of the credential that wrote them.
      if (next === null || next.source === "signed-in") {
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
            // an account with no hosted vault answers 404 forever; that is a state, not a fault to
            // hunt.
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
          tree.set({ state: "error", message: "This vault is too large for the notes list." });
          return;
        }
        // alias tiers stay empty: an alias lives in frontmatter the phone does not hold.
        resolver = buildResolver(entries.map((entry) => entry.path));
        assetSources.clear();
        tree.set({ state: "ready", commit, entries });
        bestEffort(noteCache.sweep(commit));
      } finally {
        if (refreshingFor === startedAt) refreshingFor = -1;
      }
    },

    tree,

    async readNote(path) {
      if (client === null) return { ok: false, message: "Not signed in." };
      // captured: a sign-out nulls the closure's client mid-await.
      const activeClient = client;
      const startedAt = generation;
      const current = tree.get();
      const commit = current.state === "ready" ? current.commit : undefined;

      // only a read pinned to the tree's commit touches the cache: head moves.
      if (commit !== undefined) {
        const cached = await noteCache.get(commit, path).catch(() => null);
        if (generation !== startedAt) return { ok: false, message: "Not signed in." };
        if (cached !== null) {
          return { ok: true, ...cached };
        }
      }

      const query: Parameters<Client["vaultFile"]>[0] = { path };
      if (commit !== undefined) query.ref = commit;
      const result = await activeClient.vaultFile(query);
      if (generation !== startedAt) {
        return { ok: false, message: "Not signed in." };
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

    assetSource(path) {
      const current = tree.get();
      if (client === null || current.state !== "ready") return null;
      const cached = assetSources.get(path);
      if (cached !== undefined) return cached;
      const source = client.vaultAssetSource({ path, ref: current.commit });
      assetSources.set(path, source);
      return source;
    },
  };
}
