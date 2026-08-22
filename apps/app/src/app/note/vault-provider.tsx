// The app half of the editor's host seam: one VaultSession (the recovered
// open-note ordering machine) driven over this app's HTTP + ws transports,
// published to the editor package through EditorHostProvider and the
// EditorHostIo singleton.
//
// THE WRITE IS GUARDED HERE. The session's VaultIO.write carries no base, so
// this port remembers the last content it READ per path and PUTs with that
// base's hash; a CAS 409 answers with the disk's truth, which is three-way
// merged (diff3, buffer preferred on overlap) and retried ONCE against the
// disk content's own hash. The buffer converges through the runtime's normal
// reload on the write's own files-changed broadcast — the user's bytes are in
// the merged write either way, so nothing is ever silently clobbered.

import {
  EditorHostProvider,
  type EditorHost,
  type VaultActions,
  type VaultListing,
} from "@repo/editor/host";
import {
  setEditorHostIo,
  type DeleteVaultEntryResult,
  type EditorHostIo,
  type VaultChangedEvent,
  type VaultEntry,
} from "@repo/editor/host-io";
import { createDebouncer } from "@repo/editor/lib/debounce";
import { setOpenNoteFlush } from "@repo/editor/note/open-note-flush";
import { publishOpenPath } from "@repo/editor/note/open-note-store";
import { publishEditor } from "@repo/editor/note/open-note-store";
import {
  createVaultSession,
  type VaultSession,
  type WorkspaceBoot,
} from "@repo/editor/note/vault-session";
import { useVaultActions } from "@repo/editor/host";
import { buildResolver } from "@repo/notes/knowledge/link-resolve";
import { diff3 } from "@repo/notes/text/diff3";
import { contentHashHex, type VaultTreeResponse } from "@repo/server-contract/vault";
import { toast } from "@repo/ui/components/sonner";
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";

import { readLastOpenNote, writeLastOpenNote } from "../prefs";
import { useWorkspace, type WorkspaceRuntime } from "../workspace-context";
import { BacklinksSection } from "./backlinks-panel";
import { RelatedSection } from "./related-panel";

const FOCUS_REFRESH_DEBOUNCE_MS = 400;

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
            kind: entry.path.endsWith(".md") ? ("doc" as const) : ("other" as const),
          },
        ]
      : [],
  );
}

async function readFile(api: Api, path: string): Promise<string> {
  const response = await api.vault.file.$get({ query: { path } });
  if (!response.ok) throw new Error(`read ${path}: ${String(response.status)}`);
  const body = await response.json();
  return body.content;
}

/** The knowledge panels under the document — the same placement decision as
 * before: under the note, inside its measure. */
function ConnectionsPanel({ path }: { path: string }) {
  const { openFile } = useVaultActions();
  return (
    <>
      <BacklinksSection path={path} onOpen={openFile} />
      <RelatedSection path={path} onOpen={openFile} />
    </>
  );
}

export interface VaultProviderProps {
  children: ReactNode;
  /** Mirror of the open path for the shell (sidebar highlight, palette). */
  onOpenPath: (path: string | null) => void;
  /** The session's actions, handed to the shell's own callbacks (tree ops,
   * palette) — identity is fixed for the session's life. */
  actionsRef: RefObject<VaultActions | null>;
}

export function VaultProvider({ children, onOpenPath, actionsRef }: VaultProviderProps) {
  const { api, docEvents } = useWorkspace();

  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [vaultName, setVaultName] = useState("");
  // The session publishes the root; io subscriptions compose events with it
  // outside render, so a ref keeps them honest without re-subscribing.
  const rootRef = useRef("");
  const entriesRef = useRef<VaultEntry[]>([]);

  // The mirror callback identity must not rebuild the session.
  const onOpenPathRef = useRef(onOpenPath);
  onOpenPathRef.current = onOpenPath;

  const session = useMemo<VaultSession>(() => {
    // Base bytes per path, recorded at every read; what a guarded write's
    // expectedHash is computed FROM.
    const bases = new Map<string, string>();

    const read = async (path: string): Promise<string> => {
      const content = await readFile(api, path);
      bases.set(path, content);
      return content;
    };

    const write = async (path: string, content: string): Promise<void> => {
      const base = bases.get(path) ?? content;
      const expectedHash = await contentHashHex(base);
      const response = await api.vault.file.$put({ json: { path, content, expectedHash } });
      if (response.ok) {
        bases.set(path, content);
        return;
      }
      if (response.status === 409) {
        const body = await response.json();
        if (body.error === "cas_mismatch" && body.current !== undefined) {
          const disk = body.current.content;
          const { merged } = diff3(base, content, disk);
          const retryHash = await contentHashHex(disk);
          const retry = await api.vault.file.$put({
            json: { path, content: merged, expectedHash: retryHash },
          });
          if (retry.ok) {
            bases.set(path, merged);
            return;
          }
          throw new Error(`write ${path}: conflict retry refused (${String(retry.status)})`);
        }
        throw new Error(`write ${path}: ${body.error}`);
      }
      throw new Error(`write ${path}: ${String(response.status)}`);
    };

    const remove = async (path: string): Promise<DeleteVaultEntryResult> => {
      const response = await api.vault.delete.$post({ json: { path } });
      if (response.ok) return { outcome: "trashed" };
      if (response.status === 404) return { outcome: "absent" };
      const body = await response.json();
      throw new Error(`delete ${path}: ${body.error}`);
    };

    const fetchTree = async (): Promise<VaultTreeResponse> => {
      const response = await api.vault.tree.$get();
      if (!response.ok) throw new Error("vault tree unavailable");
      return response.json();
    };

    const boot = async (): Promise<WorkspaceBoot> => {
      const tree = await fetchTree();
      setVaultName(tree.name);
      const flat = listingEntries(tree);
      // Last-open note, else the first root doc — the app never lands on an
      // empty pane when the vault has notes.
      const last = readLastOpenNote();
      const known = (path: string | null): path is string =>
        path !== null && flat.some((entry) => entry.path === path && entry.kind === "doc");
      const target = known(last)
        ? last
        : (flat.find((entry) => entry.kind === "doc")?.path ?? null);
      let openNote: WorkspaceBoot["openNote"] = null;
      if (target !== null) {
        const content = await read(target).catch(() => null);
        if (content !== null) openNote = { path: target, content };
      }
      return { root: tree.root, entries: flat, openNote };
    };

    return createVaultSession({
      boot,
      list: async () => listingEntries(await fetchTree()),
      // No host re-announce over HTTP — a refresh IS a re-list, published
      // through the same ordered path list() callers use.
      refresh: () => Promise.resolve(),
      exists: async (path) => {
        const response = await api.vault.file.$get({ query: { path } });
        return response.ok;
      },
      rename: async (from, to) => {
        const response = await api.vault.rename.$post({ json: { from, to } });
        if (response.ok) return { ok: true };
        const body = await response.json();
        return { ok: false, error: body.message };
      },
      note: { read, write, remove },
      publishListing: (next) => {
        entriesRef.current = next;
        setEntries(next);
      },
      publishRoot: (root) => {
        rootRef.current = root;
      },
      publishOpenPath: (path, change) => {
        publishOpenPath(path, change);
        writeLastOpenNote(path);
        onOpenPathRef.current(path);
      },
      publishEditor,
      // One surface: the editor column is always up in this shell.
      showEditor: () => {},
      notify: (level, message) => {
        if (level === "error") toast.error(message);
        else toast.warning(message);
      },
    });
  }, [api]);

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
        session.handleVaultChanged({
          root: rootRef.current,
          changed: docId === null ? null : { upserted: [docId], removed: [] },
        });
      }),
    [docEvents, session],
  );

  // Repairs a MISSED broadcast: a socket that dropped while the agent wrote
  // comes back to a listing nobody re-announced. One debounced re-list per
  // focus flurry closes that window.
  useEffect(() => {
    const refresh = createDebouncer(() => {
      session.handleVaultChanged({ root: rootRef.current, changed: null });
    }, FOCUS_REFRESH_DEBOUNCE_MS);
    const onFocus = (): void => {
      refresh.schedule();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      refresh.cancel();
    };
  }, [session]);

  // Non-React callers (palette actions, shortcuts) persist the live buffer
  // through this registration.
  useEffect(() => {
    setOpenNoteFlush(session.actions.flush);
    return () => {
      setOpenNoteFlush(null);
    };
  }, [session]);

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
      readVaultAsset: async ({ path }) => {
        const response = await api.vault.asset.$get({ query: { path } });
        if (!response.ok) return { ok: false, error: `asset ${String(response.status)}` };
        return { ok: true, bytesBase64: toBase64(new Uint8Array(await response.arrayBuffer())) };
      },
      writeVaultAsset: async ({ dir, baseName, file }) => {
        const bytesBase64 = toBase64(new Uint8Array(await file.arrayBuffer()));
        const response = await api.vault.asset.$post({ json: { dir, baseName, bytesBase64 } });
        if (!response.ok) {
          const body = await response.json();
          throw new Error(body.message);
        }
        return response.json();
      },
      // The listing carries no stat facts; the properties surface that asks
      // returns with #587's right panel, with its route.
      getVaultFileFacts: () => Promise.resolve(null),
      // Path-tier targets until the knowledge index serves aliases (#582).
      listWikiTargets: () =>
        Promise.resolve(
          entriesRef.current.flatMap((entry) =>
            entry.kind === "doc"
              ? [
                  {
                    path: entry.path,
                    title: entry.name.replace(/\.md$/, ""),
                    type: "doc" as const,
                  },
                ]
              : [],
          ),
        ),
      getBacklinks: async ({ path }) => {
        const response = await api.knowledge.backlinks.$get({ query: { path } });
        if (!response.ok) return [];
        const body = await response.json();
        // exactOptionalPropertyTypes: the wire's `alias?: string | undefined`
        // must drop the explicit-undefined member to satisfy the notes type.
        return body.backlinks.map(({ alias, ...row }) => {
          if (alias !== undefined) {
            return Object.assign(row, { alias });
          }
          return row;
        });
      },
      // Outgoing links are on screen in the document (decision) — nothing
      // mounted asks for them.
      getForwardLinks: () => Promise.resolve([]),
      onVaultChanged: (listener) =>
        docEvents.subscribe((docId) => {
          const event: VaultChangedEvent = {
            root: rootRef.current,
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
  }, [api, docEvents]);

  // The wiki resolver over the live listing — path tiers now, aliases with the
  // knowledge-served targets (#582).
  const listing = useMemo<VaultListing>(() => {
    const resolver = buildResolver(
      entries.map((entry) => entry.path),
      [],
    );
    return {
      entries,
      folderName: vaultName,
      resolveWikiTarget: (target) => resolver.resolveWiki(target),
    };
  }, [entries, vaultName]);

  const host = useMemo<EditorHost>(
    () => ({ actions: session.actions, listing, ConnectionsPanel }),
    [session, listing],
  );

  return <EditorHostProvider host={host}>{children}</EditorHostProvider>;
}
