import {
  setEditorHostIo,
  type EditorHostIo,
  type VaultActions,
  type VaultChangedEvent,
  type VaultEntry,
  type VaultListing,
} from "@repo/editor/host-io";
import { createDebouncer } from "@repo/editor/lib/debounce";
import { useWikiTargets } from "../vault-hooks";
import { registerOpenNoteStore } from "@repo/editor/note/open-note-flush";
import { OpenNoteStoreProvider } from "@repo/editor/note/open-note-context";
import type { OpenNoteStore } from "@repo/editor/note/open-note-store";
import {
  createVaultSession,
  type VaultSession,
  type WorkspaceBoot,
} from "@repo/editor/note/vault-session";
import {
  collectFormulas,
  noteIdOf,
  type CollectedFormula,
} from "@repo/notes/formulas/collect-formulas";
import { isDocPath } from "@repo/notes/knowledge/doc-file";
import { buildResolver } from "@repo/notes/knowledge/link-resolve";
import { basenamePath } from "@repo/notes/knowledge/vault-path";
import { base64FromBytes } from "@repo/api/cloud/bytes";
import type { KnowledgeWikiTargetsResponse } from "@repo/api/local/knowledge/knowledge-schema";
import { vaultAssetUrl } from "@repo/api/local/routes";
import type { VaultTreeResponse } from "@repo/api/local/vault/vault-schema";
import { toast } from "@repo/ui/components/sonner";
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { createStore, type StoreApi } from "zustand/vanilla";

import { refusalMessage, safe } from "../api";
import { readLastOpenNote, writeLastOpenNote } from "../prefs";
import { useWorkspace, type WorkspaceRuntime } from "../workspace-context";
import { createGuardedVaultIo } from "./guarded-vault-io";

const FOCUS_REFRESH_DEBOUNCE_MS = 400;

const noOpenPathMirror = (): void => {};

const EMPTY_LISTING: VaultListing = { entries: [], resolveWikiTarget: () => null };

type Api = WorkspaceRuntime["api"];
type WikiTargets = KnowledgeWikiTargetsResponse["targets"];

function listingEntries(tree: VaultTreeResponse): VaultEntry[] {
  return tree.entries.flatMap((entry) =>
    entry.kind === "file"
      ? [
          {
            path: entry.path,
            name: basenamePath(entry.path),
            kind: isDocPath(entry.path) ? ("doc" as const) : ("other" as const),
          },
        ]
      : [],
  );
}

async function readFile(api: Api, path: string): Promise<string> {
  const { content } = await api.vault.read({ path });
  return content;
}

export interface VaultProviderProps {
  children: ReactNode;
  initialPath: string | null;
  onOpenPath: (path: string | null) => void;
  actionsRef: RefObject<VaultActions | null>;
  store: OpenNoteStore;
}

export function VaultProvider({
  children,
  initialPath,
  onOpenPath,
  actionsRef,
  store,
}: VaultProviderProps) {
  // Captured once: a later navigation must not re-run the boot preference.
  const [bootPath] = useState(initialPath);
  const { api, docEvents } = useWorkspace();

  const formulaScanRef = useRef<Promise<
    Map<string, { path: string; formulas: CollectedFormula[] }>
  > | null>(null);

  const wikiTargetsQuery = useWikiTargets();
  const wikiTargets = useMemo<WikiTargets>(
    () => wikiTargetsQuery.data?.targets ?? [],
    [wikiTargetsQuery.data],
  );

  const port = useMemo<VaultPort>(
    () => createVaultPort({ api, bootPath, store }),
    [api, bootPath, store],
  );
  const { session } = port;

  // Must run before the start effect so the first published open path reaches
  // the shell. Re-pointed rather than passed at construction: the callback's
  // identity changes every parent render, and rebuilding the session re-boots
  // the vault.
  useEffect(() => {
    port.setOnOpenPath(onOpenPath);
  }, [port, onOpenPath]);

  useEffect(() => {
    port.setWikiTargets(wikiTargets);
  }, [port, wikiTargets]);

  useEffect(() => {
    actionsRef.current = session.actions;
  }, [session, actionsRef]);

  // Installed ahead of start(): the note the boot publishes mounts hooks that
  // read this singleton during render.
  useEffect(() => {
    const io: EditorHostIo = {
      actions: session.actions,
      listing: port.listing,
      readVaultFile: ({ path }) => readFile(api, path),
      // A plain fetch, not a procedure: the ETag and sandbox CSP do not
      // survive an RPC envelope.
      readVaultAsset: async ({ path }) => {
        const response = await fetch(vaultAssetUrl(window.location.origin, path));
        if (!response.ok) return { ok: false, error: `asset ${String(response.status)}` };
        return { ok: true, bytes: await response.blob() };
      },
      writeVaultAsset: async ({ dir, baseName, file }) => {
        const bytesBase64 = base64FromBytes(new Uint8Array(await file.arrayBuffer()));
        return api.vault.assetWrite({ dir, baseName, bytesBase64 });
      },
      listWikiTargets: () =>
        // exactOptionalPropertyTypes: drop the explicit-undefined members.
        Promise.resolve(
          port.wikiTargets().map(({ aliases, pinned, ...target }) => {
            const withAliases = aliases === undefined ? target : Object.assign(target, { aliases });
            return pinned === undefined ? withAliases : Object.assign(withAliases, { pinned });
          }),
        ),
      getBacklinks: async ({ path }) => {
        const body = await api.knowledge.backlinks({ path }).catch(() => null);
        if (body === null) return [];
        // exactOptionalPropertyTypes: drop the explicit-undefined member.
        return body.backlinks.map(({ alias, ...row }) => {
          if (alias !== undefined) {
            return Object.assign(row, { alias });
          }
          return row;
        });
      },
      readNoteFormulas: async ({ noteId }) => {
        let scan = formulaScanRef.current;
        if (scan === null) {
          scan = (async () => {
            const byId = new Map<string, { path: string; formulas: CollectedFormula[] }>();
            for (const entry of port.entries()) {
              if (entry.kind !== "doc") continue;
              const content = await readFile(api, entry.path).catch(() => null);
              if (content === null) continue;
              const id = noteIdOf(content);
              if (id !== null && !byId.has(id)) {
                byId.set(id, { formulas: collectFormulas(content), path: entry.path });
              }
            }
            return byId;
          })();
          formulaScanRef.current = scan;
        }
        return (await scan).get(noteId) ?? null;
      },
      // Nothing mounted asks for outgoing links; they are on screen in the document.
      getForwardLinks: () => Promise.resolve([]),
      onVaultChanged: (listener) =>
        docEvents.subscribe((docId) => {
          const event: VaultChangedEvent = {
            root: port.root(),
            changed: docId === null ? null : { upserted: [docId], removed: [] },
          };
          listener(event);
        }),
      onKnowledgeUpdated: (listener) =>
        docEvents.subscribe(() => {
          listener();
        }),
    };
    setEditorHostIo(io);
  }, [api, docEvents, port, session]);

  useEffect(() => {
    void session.start();
    return () => {
      session.stop();
    };
  }, [session]);

  useEffect(
    () =>
      docEvents.subscribe((docId) => {
        formulaScanRef.current = null;
        session.handleVaultChanged({
          root: port.root(),
          changed: docId === null ? null : { upserted: [docId], removed: [] },
        });
      }),
    [docEvents, port, session],
  );

  // A socket that dropped while the agent wrote comes back to a listing
  // nobody re-announced.
  useEffect(() => {
    const refresh = createDebouncer(() => {
      session.handleVaultChanged({ root: port.root(), changed: null });
    }, FOCUS_REFRESH_DEBOUNCE_MS);
    const onFocus = (): void => {
      refresh.schedule();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      refresh.cancel();
    };
  }, [port, session]);

  // No unload/pagehide flush: a `keepalive` write is best-effort, and a tab
  // closed mid-debounce losing that window is the accepted trade.
  useEffect(() => {
    store.setFlush(session.actions.flush);
    const unregister = registerOpenNoteStore(store);
    return () => {
      store.setFlush(null);
      unregister();
    };
  }, [session, store]);

  return <OpenNoteStoreProvider store={store}>{children}</OpenNoteStoreProvider>;
}

// Closure state rather than the provider's refs: the session is built during
// render, and a ref read by a function render calls is a ref read in render.
type VaultPort = {
  readonly session: VaultSession;
  readonly listing: StoreApi<VaultListing>;
  root: () => string;
  entries: () => readonly VaultEntry[];
  wikiTargets: () => WikiTargets;
  setWikiTargets: (next: WikiTargets) => void;
  setOnOpenPath: (next: (path: string | null) => void) => void;
};

type VaultPortInputs = {
  api: Api;
  bootPath: string | null;
  store: OpenNoteStore;
};

function createVaultPort({ api, bootPath, store }: VaultPortInputs): VaultPort {
  let root = "";
  let entries: readonly VaultEntry[] = [];
  let wikiTargets: WikiTargets = [];
  let mirrorOpenPath: (path: string | null) => void = noOpenPathMirror;
  const listing = createStore<VaultListing>()(() => EMPTY_LISTING);
  // Rebuilt whole from either input: the resolver's identity is what tells a chip to re-render.
  const rebuildListing = (): void => {
    const aliasEntries: Array<readonly [string, string]> = [];
    for (const target of wikiTargets) {
      for (const alias of target.aliases ?? []) aliasEntries.push([alias, target.path]);
    }
    const resolver = buildResolver(
      entries.map((entry) => entry.path),
      aliasEntries,
    );
    listing.setState({ entries, resolveWikiTarget: (target) => resolver.resolveWiki(target) });
  };
  const io = createGuardedVaultIo(api);
  const session = createVaultSession({
    boot: async (): Promise<WorkspaceBoot> => {
      const tree = await api.vault.tree();
      const flat = listingEntries(tree);
      const known = (path: string | null): path is string =>
        path !== null && flat.some((entry) => entry.path === path && entry.kind === "doc");
      const last = readLastOpenNote();
      // Welcome.md ahead of listing order, which lands on "Getting Started" first.
      const target = known(bootPath)
        ? bootPath
        : known(last)
          ? last
          : known("Welcome.md")
            ? "Welcome.md"
            : (flat.find((entry) => entry.kind === "doc")?.path ?? null);
      let openNote: WorkspaceBoot["openNote"] = null;
      if (target !== null) {
        const content = await io.read(target).catch(() => null);
        if (content !== null) openNote = { path: target, content };
      }
      return { root: tree.root, entries: flat, openNote };
    },
    list: async () => listingEntries(await api.vault.tree()),
    // A refresh is a re-list; there is no host re-announce.
    refresh: () => Promise.resolve(),
    // Any refusal reads as absent: the caller's next step is a write, which
    // reports its own failure.
    exists: async (path) => {
      const { error } = await safe(api.vault.read({ path }));
      return error === null;
    },
    rename: async (from, to) => {
      try {
        await api.vault.rename({ from, to });
        return { ok: true };
      } catch (error) {
        return { ok: false, error: refusalMessage(error, `Could not rename ${from}.`) };
      }
    },
    note: io,
    publishListing: (next) => {
      entries = next;
      rebuildListing();
    },
    publishRoot: (next) => {
      root = next;
    },
    publishOpenPath: (path, change) => {
      store.publishOpenPath(path, change);
      writeLastOpenNote(path);
      mirrorOpenPath(path);
    },
    publishEditor: store.publishEditor,
    // The editor column is always up in this shell.
    showEditor: () => {},
    notify: (level, message) => {
      if (level === "error") toast.error(message);
      else toast.warning(message);
    },
  });

  return {
    session,
    listing,
    root: () => root,
    entries: () => entries,
    wikiTargets: () => wikiTargets,
    setWikiTargets: (next) => {
      wikiTargets = next;
      rebuildListing();
    },
    setOnOpenPath: (next) => {
      mirrorOpenPath = next;
    },
  };
}
