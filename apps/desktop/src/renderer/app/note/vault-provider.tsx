// The app half of the editor's host seam: one VaultSession (the recovered
// open-note ordering machine) driven over this app's HTTP + ws transports,
// published to the editor package through EditorHostProvider and the
// EditorHostIo singleton.
//
// The note port itself — the CAS-guarded write, the exclusive create and the
// diff3 retry — is `guarded-vault-io.ts`, framework-free so its policy
// unit-tests against the real vault.

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

/** What a port's open-path mirror does until the provider installs the shell's
 * own callback, which it does before the session is started. */
const noOpenPathMirror = (): void => {};

type Api = WorkspaceRuntime["api"];

/** The session's flat listing from the tree response: files only (the tree is
 * derived from paths), split into editable docs and everything else. */
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
  /** A deep link's note (the route's `note` search param), consulted once at
   * boot ahead of the localStorage restore. */
  initialPath: string | null;
  /** Mirror of the open path for the shell (sidebar highlight, palette). */
  onOpenPath: (path: string | null) => void;
  /** The session's actions, handed to the shell's own callbacks (tree ops,
   * palette) — identity is fixed for the session's life. */
  actionsRef: RefObject<VaultActions | null>;
  /** The open note's store, owned by the workspace: the shell reads the open
   * path and its history off the same instance this session publishes into. */
  store: OpenNoteStore;
}

export function VaultProvider({
  children,
  initialPath,
  onOpenPath,
  actionsRef,
  store,
}: VaultProviderProps) {
  // Captured once: the param mirrors back through onOpenPath after boot, and
  // a later navigation must not re-run the boot preference.
  const [bootPath] = useState(initialPath);
  const { api, docEvents } = useWorkspace();

  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [vaultName, setVaultName] = useState("");
  // The bound-ref scan cache (readNoteFormulas below); dropped whole on any
  // vault change.
  const formulaScanRef = useRef<Promise<
    Map<string, { path: string; formulas: CollectedFormula[] }>
  > | null>(null);

  // Alias-carrying wiki targets from the knowledge index — the same alias
  // source backlinks resolve with, so chips and the picker agree. The shared
  // query rides the knowledge family's sweeps (the index lags saves
  // ~100-300ms; a just-added alias resolves slightly late, same as the
  // backlinks panel); structural sharing keeps the reference stable when the
  // payload is unchanged, so the resolver memo stands. The ref mirrors it for
  // the non-React EditorHostIo singleton.
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

  // Installed BEFORE the start effect below, so the first open path the session
  // publishes already reaches the shell. It is re-pointed rather than passed in
  // at construction because this callback's identity changes on every parent
  // render, and rebuilding the session would re-boot the vault.
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

  // The ws bus carries change-kind pings, never payloads: a files-changed
  // ping names a path when the watcher could attribute one, or nothing. Both
  // map onto the session's broadcast shape — `changed: null` means "cannot
  // say", which reloads the open note and re-lists.
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

  // Repairs a MISSED broadcast: a socket that dropped while the agent wrote
  // comes back to a listing nobody re-announced. One debounced re-list per
  // focus flurry closes that window.
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

  // Non-React callers (palette actions, shortcuts) persist the live buffer
  // through the store registry; the flush action itself lives in the store.
  // There is deliberately NO unload/pagehide last-gasp flush: a tab closed
  // mid-debounce loses that debounce window, an accepted trade rather than a
  // gap to plug — a `keepalive` write is best-effort and the desktop shell is
  // the real surface. This registry is the seam a real answer would hang off.
  useEffect(() => {
    store.setFlush(session.actions.flush);
    const unregister = registerOpenNoteStore(store);
    return () => {
      store.setFlush(null);
      unregister();
    };
  }, [session, store]);

  // The editor's I/O singleton, installed before any editor mounts. Reads ride
  // the same routes the app already serves; subscriptions ride the ws bus.
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
      // The read is a plain fetch, not a procedure: the bytes come back raw
      // with an ETag and a sandbox CSP, none of which survives an RPC
      // envelope, so `/vault/asset` is one of the routes that stays HTTP.
      readVaultAsset: async ({ path }) => {
        const response = await fetch(vaultAssetUrl(window.location.origin, path));
        if (!response.ok) return { ok: false, error: `asset ${String(response.status)}` };
        // The Blob carries the route's own `content-type`, which is the shared
        // allowlist's answer — so nothing downstream re-derives one.
        return { ok: true, bytes: await response.blob() };
      },
      writeVaultAsset: async ({ dir, baseName, file }) => {
        const bytesBase64 = toBase64(new Uint8Array(await file.arrayBuffer()));
        return api.vault.assetWrite({ dir, baseName, bytesBase64 });
      },
      // The listing carries no stat facts; the properties surface that asks
      // returns with #587's right panel, with its route.
      getVaultFileFacts: () => Promise.resolve(null),
      listWikiTargets: () =>
        // exactOptionalPropertyTypes: the wire's optional members must drop
        // the explicit-undefined member to satisfy the notes type.
        Promise.resolve(
          wikiTargetsRef.current.map(({ aliases, pinned, ...target }) => {
            const withAliases = aliases === undefined ? target : Object.assign(target, { aliases });
            return pinned === undefined ? withAliases : Object.assign(withAliases, { pinned });
          }),
        ),
      getBacklinks: async ({ path }) => {
        const body = await api.knowledge.backlinks({ path }).catch(() => null);
        if (body === null) return [];
        // exactOptionalPropertyTypes: the wire's `alias?: string | undefined`
        // must drop the explicit-undefined member to satisfy the notes type.
        return body.backlinks.map(({ alias, ...row }) => {
          if (alias !== undefined) {
            return Object.assign(row, { alias });
          }
          return row;
        });
      },
      // Bound-reference resolution: which note carries frontmatter id X, and
      // what formulas it holds. Lazily scans the vault's docs ONCE (bound
      // refs are rare), caches by note id, and drops the cache whole on any
      // files-changed ping — correctness over cleverness, stated cost.
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
      // Outgoing links are on screen in the document (decision) — nothing
      // mounted asks for them.
      getForwardLinks: () => Promise.resolve([]),
      onVaultChanged: (listener) =>
        docEvents.subscribe((docId) => {
          const event: VaultChangedEvent = {
            root: port.root(),
            changed: docId === null ? null : { upserted: [docId], removed: [] },
          };
          listener(event);
        }),
      // Knowledge settles behind the same files-changed sweep in this app.
      onKnowledgeUpdated: (listener) =>
        docEvents.subscribe(() => {
          listener();
        }),
    };
    setEditorHostIo(io);
  }, [api, docEvents, port]);

  // The wiki resolver over the live listing — path tiers now, aliases with the
  // knowledge-served targets (#582).
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

/**
 * The session plus the live values its non-React callers compose events with.
 *
 * The vault root, the last published listing and the shell's open-path mirror
 * stay mutable for the session's whole life, and every reader of them runs
 * outside render — the ws-bus handlers, the EditorHostIo subscriptions. They
 * live in this closure rather than in the provider's refs because the session
 * is BUILT during render, and a ref handed to a function that render calls is
 * a ref render can read: exactly what React forbids. Their lifetime is the
 * session's, which is what this port makes structural.
 */
type VaultPort = {
  readonly session: VaultSession;
  /** The root as last published — what a broadcast is composed with. */
  root: () => string;
  /** The listing as last published, for the bound-reference scan. */
  entries: () => readonly VaultEntry[];
  /** Re-point the shell's open-path mirror. The callback's identity changes on
   * every parent render; the session's must not. */
  setOnOpenPath: (next: (path: string | null) => void) => void;
};

type VaultPortInputs = {
  api: Api;
  /** A deep link's note, consulted once at boot ahead of the localStorage
   * restore. */
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
      // The deep link wins, then the last-open note, then the first doc — the
      // app never lands on an empty editor when the vault has notes.
      const known = (path: string | null): path is string =>
        path !== null && flat.some((entry) => entry.path === path && entry.kind === "doc");
      const last = readLastOpenNote();
      // Among the virgin-boot seeds, Welcome is the front door — plain
      // listing order would land on "Getting Started" first.
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
    // No host re-announce over HTTP — a refresh IS a re-list, published
    // through the same ordered path list() callers use.
    refresh: () => Promise.resolve(),
    // Any refusal reads as "not there", and that is safe because of what the
    // caller does next: open-or-create re-attempts the same path with a write,
    // which reports its own failure rather than truncating anything.
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
    // One surface: the editor column is always up in this shell.
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
