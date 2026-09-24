import { useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { setEditorHostIo } from "@repo/editor/host-io";
import type { EditorHostIo, LinkResolver, VaultActions, VaultEntry } from "@repo/editor/host-io";
import { readVaultTree, readWikiTargets, renameVaultEntry, useWikiTargets } from "../vault-hooks";
import { registerOpenNoteStore } from "@repo/editor/note/open-note-flush";
import { OpenNoteStoreProvider } from "@repo/editor/note/open-note-context";
import type { OpenNoteStore } from "@repo/editor/note/open-note-store";
import { createVaultSession } from "@repo/editor/note/vault-session";
import type { VaultSession, WorkspaceBoot } from "@repo/editor/note/vault-session";
import { isDocPath } from "@repo/notes/knowledge/doc-file";
import type { WikiTarget } from "@repo/notes/knowledge/link-graph-index";
import { buildResolver } from "@repo/notes/knowledge/link-resolve";
import { basenamePath } from "@repo/notes/knowledge/vault-path";
import { base64FromBytes } from "@repo/api/cloud/bytes";
import { vaultAssetUrl } from "@repo/api/local/routes";
import { attachmentDir } from "@repo/api/local/vault/attachment-location";
import type { VaultTreeResponse } from "@repo/api/local/vault/vault-schema";
import { confirm } from "@repo/ui/components/confirm-dialog";
import { toast } from "@repo/ui/components/sonner";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";

import { safe } from "../api";
import { readLastOpenNote, writeLastOpenNote } from "../prefs";
import { useWorkspace } from "../workspace-context";
import type { WorkspaceRuntime } from "../workspace-context";
import { createGuardedVaultIo } from "./guarded-vault-io";
import { createNoteFormulas } from "./note-formulas";
import type { NoteFormulas } from "./note-formulas";

const noOpenPathMirror = (): void => {
  /* empty */
};

const noHistory = (): void => {
  /* empty */
};

const NO_RESOLVER: LinkResolver = {
  resolveMdTarget: () => null,
  resolveWikiTarget: () => null,
  targets: [],
};

type Api = WorkspaceRuntime["api"];

const listingEntries = (tree: VaultTreeResponse): VaultEntry[] =>
  tree.entries.flatMap((entry) =>
    entry.kind === "file"
      ? [
          {
            kind: isDocPath(entry.path) ? ("doc" as const) : ("other" as const),
            name: basenamePath(entry.path),
            path: entry.path,
          },
        ]
      : [],
  );

const readFile = async (api: Api, path: string): Promise<string> => {
  const { content } = await api.vault.read({ path });
  return content;
};

export interface VaultProviderProps {
  children: ReactNode;
  initialPath: string | null;
  onOpenPath: (path: string | null) => void;
  onShowHistory: (path: string) => void;
  actionsRef: RefObject<VaultActions | null>;
  store: OpenNoteStore;
}

// Closure state rather than the provider's refs: the session is built during
// render, and a ref read by a function render calls is a ref read in render.
interface VaultPort {
  readonly session: VaultSession;
  readonly linkResolver: StoreApi<LinkResolver>;
  readonly formulas: NoteFormulas;
  setWikiTargets: (next: readonly WikiTarget[]) => void;
  setOnOpenPath: (next: (path: string | null) => void) => void;
  setOnShowHistory: (next: (path: string) => void) => void;
}

interface VaultPortInputs {
  api: Api;
  bootPath: string | null;
  queryClient: QueryClient;
  store: OpenNoteStore;
}

const createVaultPort = ({ api, bootPath, queryClient, store }: VaultPortInputs): VaultPort => {
  let entries: readonly VaultEntry[] = [];
  let wikiTargets: readonly WikiTarget[] = [];
  let mirrorOpenPath: (path: string | null) => void = noOpenPathMirror;
  let showHistory: (path: string) => void = noHistory;
  const linkResolver = createStore<LinkResolver>()(() => NO_RESOLVER);
  // Rebuilt whole from either input: the resolver's identity is what tells a link to re-render.
  const rebuildResolver = (): void => {
    const aliasEntries: (readonly [string, string])[] = [];
    const idEntries: (readonly [string, string])[] = [];
    for (const target of wikiTargets) {
      for (const alias of target.aliases ?? []) {
        aliasEntries.push([alias, target.path]);
      }
      if (target.id !== undefined) {
        idEntries.push([target.id, target.path]);
      }
    }
    const resolver = buildResolver(
      entries.map((entry) => entry.path),
      aliasEntries,
      idEntries,
    );
    linkResolver.setState({
      resolveMdTarget: (target, fromPath) => resolver.resolveMd(target, fromPath),
      resolveWikiTarget: (target, alias) => resolver.resolveWiki(target, alias),
      targets: wikiTargets,
    });
  };
  const io = createGuardedVaultIo(api);
  const formulas = createNoteFormulas({
    listTargets: async () => {
      const { targets } = await readWikiTargets(queryClient);
      return targets;
    },
    readFile: async (path) => await readFile(api, path),
  });
  const session = createVaultSession({
    // discarding is the confirm, so an Escape or a dismissal re-creates and the edits survive it.
    askVanished: async (path) =>
      (await confirm({
        body: "It was deleted while it had unsaved edits. Re-create it with them, or discard them.",
        cancelLabel: "Re-create",
        confirmLabel: "Discard edits",
        destructive: true,
        title: `${basenamePath(path)} was deleted`,
      }))
        ? "discard"
        : "recreate",
    boot: async (): Promise<WorkspaceBoot> => {
      const flat = listingEntries(await readVaultTree(queryClient));
      const known = (path: string | null): path is string =>
        path !== null && flat.some((entry) => entry.path === path && entry.kind === "doc");
      // Welcome.md ahead of listing order, which lands on "Getting Started" first.
      const target =
        [bootPath, readLastOpenNote(), "Welcome.md"].find(known) ??
        flat.find((entry) => entry.kind === "doc")?.path ??
        null;
      let openNote: WorkspaceBoot["openNote"] = null;
      if (target !== null) {
        const content = await io.read(target).catch(() => null);
        if (content !== null) {
          openNote = { content, path: target };
        }
      }
      return { entries: flat, openNote };
    },
    // Any refusal reads as absent: the caller's next step is a write, which
    // reports its own failure.
    exists: async (path) => {
      const { error } = await safe(api.vault.read({ path }));
      return error === null;
    },
    list: async () => listingEntries(await readVaultTree(queryClient)),
    note: io,
    notify: (message) => {
      toast.error(message);
    },
    notifyMergeConflict: (path) => {
      toast.warning(
        `${path} also changed elsewhere. Where both changed the same lines, yours were kept.`,
        {
          action: {
            label: "Open History",
            onClick: () => {
              showHistory(path);
            },
          },
        },
      );
    },
    publishEditor: store.publishEditor,
    publishListing: (next) => {
      entries = next;
      rebuildResolver();
    },
    publishOpenPath: (path, change) => {
      store.publishOpenPath(path, change);
      writeLastOpenNote(path);
      mirrorOpenPath(path);
    },
    rename: async (from, to) => await renameVaultEntry(api, from, to),
  });

  return {
    formulas,
    linkResolver,
    session,
    setOnOpenPath: (next) => {
      mirrorOpenPath = next;
    },
    setOnShowHistory: (next) => {
      showHistory = next;
    },
    setWikiTargets: (next) => {
      wikiTargets = next;
      rebuildResolver();
    },
  };
};

export const VaultProvider = ({
  children,
  initialPath,
  onOpenPath,
  onShowHistory,
  actionsRef,
  store,
}: VaultProviderProps) => {
  // Captured once: a later navigation must not re-run the boot preference.
  // oxlint-disable-next-line react/hook-use-state -- a per-mount constant: React's lazy initializer, no setter exists
  const [bootPath] = useState(initialPath);
  const { api, vaultChanges } = useWorkspace();
  const queryClient = useQueryClient();

  const wikiTargetsQuery = useWikiTargets();
  const wikiTargets = useMemo(() => wikiTargetsQuery.data?.targets ?? [], [wikiTargetsQuery.data]);

  const port = useMemo<VaultPort>(
    () => createVaultPort({ api, bootPath, queryClient, store }),
    [api, bootPath, queryClient, store],
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
    port.setOnShowHistory(onShowHistory);
  }, [port, onShowHistory]);

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
      getBacklinks: async ({ path }) => {
        const body = await api.knowledge.backlinks({ path }).catch(() => null);
        return body === null ? [] : body.backlinks;
      },
      linkResolver: port.linkResolver,
      onVaultChanged: (listener) => vaultChanges.subscribe(listener),
      readNoteFormulas: port.formulas.read,
      // A plain fetch, not a procedure: the ETag and sandbox CSP do not
      // survive an RPC envelope.
      readVaultAsset: async ({ path }) => {
        const response = await fetch(vaultAssetUrl(window.location.origin, path));
        if (!response.ok) {
          return { error: `asset ${String(response.status)}`, ok: false };
        }
        return { bytes: await response.blob(), ok: true };
      },
      readVaultFile: async ({ path }) => await readFile(api, path),
      // the choice is read per paste, not cached: the CLI can change it between two pastes.
      writeVaultAsset: async ({ baseName, file }) => {
        const { attachments } = await api.vault.prefs();
        const dir = attachmentDir(attachments, store.state().openPath);
        const bytesBase64 = base64FromBytes(new Uint8Array(await file.arrayBuffer()));
        return await api.vault.assetWrite({ baseName, bytesBase64, dir });
      },
    };
    setEditorHostIo(io);
  }, [api, vaultChanges, port, session, store]);

  useEffect(() => {
    void session.start();
    return () => {
      session.stop();
    };
  }, [session]);

  useEffect(
    () =>
      vaultChanges.subscribe((event) => {
        port.formulas.forget(event);
        session.handleVaultChanged(event);
      }),
    [vaultChanges, port, session],
  );

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
};
