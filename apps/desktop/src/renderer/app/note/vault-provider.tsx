import {
  EditorHostProvider,
  type EditorHost,
  type VaultActions,
  type VaultListing,
} from "@repo/editor/host";
import {
  setEditorHostIo,
  type EditorHostIo,
  type VaultChangedEvent,
  type VaultEntry,
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
import type { KnowledgeWikiTargetsResponse } from "@repo/api/local/knowledge/knowledge-schema";
import { vaultAssetUrl } from "@repo/api/local/routes";
import type { VaultTreeResponse } from "@repo/api/local/vault/vault-schema";
import { toast } from "@repo/ui/components/sonner";
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";

import { refusalMessage, safe } from "../api";
import { readLastOpenNote, writeLastOpenNote } from "../prefs";
import { useWorkspace, type WorkspaceRuntime } from "../workspace-context";
import { createGuardedVaultIo } from "./guarded-vault-io";

const FOCUS_REFRESH_DEBOUNCE_MS = 400;

const noOpenPathMirror = (): void => {};

type Api = WorkspaceRuntime["api"];

function listingEntries(tree: VaultTreeResponse): VaultEntry[] {
  return tree.entries.flatMap((entry) =>
    entry.kind === "file"
      ? [
          {
            path: entry.path,
            name: entry.path.split("/").pop() ?? entry.path,
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

  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [vaultName, setVaultName] = useState("");
  const formulaScanRef = useRef<Promise<
    Map<string, { path: string; formulas: CollectedFormula[] }>
  > | null>(null);

  const wikiTargetsQuery = useWikiTargets();
  const wikiTargets = useMemo<KnowledgeWikiTargetsResponse["targets"]>(
    () => wikiTargetsQuery.data?.targets ?? [],
    [wikiTargetsQuery.data],
  );
  const wikiTargetsRef = useRef<KnowledgeWikiTargetsResponse["targets"]>([]);
  useEffect(() => {
    wikiTargetsRef.current = wikiTargets;
  }, [wikiTargets]);

  const port = useMemo<VaultPort>(
    () =>
      createVaultPort({
        api,
        bootPath,
        store,
        publishEntries: setEntries,
        publishVaultName: setVaultName,
      }),
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
    actionsRef.current = session.actions;
  }, [session, actionsRef]);

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

  useEffect(() => {
    const toBase64 = (bytes: Uint8Array): string => {
      let binary = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      return btoa(binary);
    };
    const io: EditorHostIo = {
      readVaultFile: ({ path }) => readFile(api, path),
      // A plain fetch, not a procedure: the ETag and sandbox CSP do not
      // survive an RPC envelope.
      readVaultAsset: async ({ path }) => {
        const response = await fetch(vaultAssetUrl(window.location.origin, path));
        if (!response.ok) return { ok: false, error: `asset ${String(response.status)}` };
        return { ok: true, bytes: await response.blob() };
      },
      writeVaultAsset: async ({ dir, baseName, file }) => {
        const bytesBase64 = toBase64(new Uint8Array(await file.arrayBuffer()));
        return api.vault.assetWrite({ dir, baseName, bytesBase64 });
      },
      listWikiTargets: () =>
        // exactOptionalPropertyTypes: drop the explicit-undefined members.
        Promise.resolve(
          wikiTargetsRef.current.map(({ aliases, pinned, ...target }) => {
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
  }, [api, docEvents, port]);

  const listing = useMemo<VaultListing>(() => {
    const aliasEntries: Array<readonly [string, string]> = [];
    for (const target of wikiTargets) {
      for (const alias of target.aliases ?? []) aliasEntries.push([alias, target.path]);
    }
    const resolver = buildResolver(
      entries.map((entry) => entry.path),
      aliasEntries,
    );
    return {
      entries,
      folderName: vaultName,
      resolveWikiTarget: (target) => resolver.resolveWiki(target),
    };
  }, [entries, vaultName, wikiTargets]);

  const host = useMemo<EditorHost>(
    () => ({ actions: session.actions, listing }),
    [session, listing],
  );

  return (
    <OpenNoteStoreProvider store={store}>
      <EditorHostProvider host={host}>{children}</EditorHostProvider>
    </OpenNoteStoreProvider>
  );
}

// Closure state rather than the provider's refs: the session is built during
// render, and a ref read by a function render calls is a ref read in render.
type VaultPort = {
  readonly session: VaultSession;
  root: () => string;
  entries: () => readonly VaultEntry[];
  setOnOpenPath: (next: (path: string | null) => void) => void;
};

type VaultPortInputs = {
  api: Api;
  bootPath: string | null;
  store: OpenNoteStore;
  publishEntries: (entries: VaultEntry[]) => void;
  publishVaultName: (name: string) => void;
};

function createVaultPort({
  api,
  bootPath,
  store,
  publishEntries,
  publishVaultName,
}: VaultPortInputs): VaultPort {
  let root = "";
  let listing: readonly VaultEntry[] = [];
  let mirrorOpenPath: (path: string | null) => void = noOpenPathMirror;
  const io = createGuardedVaultIo(api);
  const session = createVaultSession({
    boot: async (): Promise<WorkspaceBoot> => {
      const tree = await api.vault.tree();
      publishVaultName(tree.name);
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
      listing = next;
      publishEntries(next);
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
    root: () => root,
    entries: () => listing,
    setOnOpenPath: (next) => {
      mirrorOpenPath = next;
    },
  };
}
