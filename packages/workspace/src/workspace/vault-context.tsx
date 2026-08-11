import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { toast } from "@repo/ui/components/sonner";

import { docExists, getBridge } from "@repo/bridge/client";
import { createDebouncer } from "@repo/editor/lib/debounce";
import { EditorHostProvider, type EditorHost, type VaultListing } from "@repo/editor/host";
import { ConnectionsPanel } from "@repo/workspace/workspace/connections-panel";
import { hasTransientSuggestions } from "@repo/editor/ai/suggestions";
import { hasTransientAiState } from "@repo/editor/ai/transient";
import { settleTransients } from "@repo/editor/ai/transient-settle";
import {
  registerOpenNoteFlush,
  registerOpenNotePath,
  registerOpenNotePrivacy,
} from "@repo/editor/note/open-note-flush";
import { notePrivacy } from "@repo/notes/markdown/frontmatter";
import { getLiveEditor } from "@repo/editor/live-editor";
import { createCaptureApplier, insertCaptureLine } from "@repo/workspace/workspace/capture-apply";
import { openNoteState, publishEditor, publishOpenPath } from "@repo/editor/note/open-note-store";
import { createVaultSession } from "@repo/workspace/workspace/vault-session";
import { useUiStateStore } from "@repo/workspace/stores/ui-state-store";
import { useViewStore } from "@repo/workspace/stores/view-store";
import { workspaceBoot } from "@repo/workspace/stores/workspace-boot";
import type { WikiTarget } from "@repo/notes/knowledge/link-graph-index";
import { buildResolver } from "@repo/notes/knowledge/link-resolve";

import type { VaultEntry } from "@repo/bridge/vault";
import { UI_STATE_OPEN_NOTE_KEY as OPEN_NOTE_KEY } from "@repo/bridge/ui-state";

/** Debounce window-focus → vault refresh so a flurry of focus/blur (alt-tab,
 * dialogs) coalesces into one refresh. */
const FOCUS_REFRESH_DEBOUNCE_MS = 1000;

// ---------------------------------------------------------------------------
// This provider is the REACT WIRING over `vault-session`: it binds the
// session's ports to the Bridge, the open-note store and the toaster, mirrors
// the two low-cadence values it publishes into state, and subscribes the
// effects a session cannot own (a window listener, a Bridge subscription, an
// unmount). Every ordering rule lives in the session.
//
// Three exposure seams, split by change CADENCE so a keystroke re-renders only
// what depends on the open note's content:
// - useVaultActions — the session's own actions (identity never changes).
//   Consumers that only ACT (wiki chips, palette actions, sidebar handlers)
//   never re-render from vault state at all.
// - useVaultListing — entries + folderName + resolveWikiTarget; changes only
//   on a structural refresh (or when the wiki resolver rebuilds).
// - useOpenNote (@repo/editor/note/open-note-store) — the high-cadence
//   open-note slice, subscribed via selectors.
// ---------------------------------------------------------------------------

export function VaultProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [root, setRoot] = useState("");

  // Built once, and inert until `start()` — so React's double-invoked
  // initializer can construct one and throw it away with nothing to undo.
  const [session] = useState(() =>
    createVaultSession({
      boot: workspaceBoot,
      list: () => getBridge().listVault(),
      refresh: () => getBridge().refreshVault(),
      exists: (path) => docExists(getBridge(), path),
      rename: (from, to) => getBridge().renameVaultEntry({ from, to }),
      note: {
        read: (path) => getBridge().readVaultFile({ path }),
        write: (path, content) => getBridge().writeVaultFile({ path, content }),
        remove: (path) => getBridge().deleteVaultEntry({ path }),
      },
      publishListing: setEntries,
      publishRoot: setRoot,
      publishOpenPath: (path, change) => {
        publishOpenPath(path, change);
        useUiStateStore.getState().set(OPEN_NOTE_KEY, path);
      },
      publishEditor,
      // Navigation always lands on the editor: opening a note from the graph,
      // the palette or a wiki chip must show the note.
      showEditor: () => useViewStore.getState().setSurface("editor"),
      notify: (level, message) => {
        if (level === "error") toast.error(message);
        else toast.warning(message);
      },
      settleAiSession: settleTransients,
    }),
  );

  useEffect(() => {
    void session.start();
    return () => session.stop();
  }, [session]);

  // Live updates: the host is the vault's only writer and announces every
  // change.
  useEffect(
    () => getBridge().onVaultChanged((event) => session.handleVaultChanged(event)),
    [session],
  );

  // NOT polling — this is what repairs a MISSED broadcast. A socket that
  // dropped while the agent was writing comes back to a listing nobody
  // re-announced: reconnect hydration replays the event getters, not the vault.
  // One debounced re-query per focus flurry closes that window and costs
  // nothing otherwise.
  useEffect(() => {
    const refresh = createDebouncer(session.actions.refreshVault, FOCUS_REFRESH_DEBOUNCE_MS);
    const onFocus = () => refresh.schedule();
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      refresh.cancel();
    };
  }, [session]);

  // Deep-link captures (inteligir://append|task) targeting the OPEN note are
  // routed INTO the live buffer — a host disk write would be skipped by the
  // dirty reload guard and clobbered by the next whole-buffer autosave. Rich
  // mode inserts through the live Plate editor (serialize → editNote carries
  // it); Raw mode appends via the session's editNote. Ack goes out only after a
  // confirmed flush; anything else ("not-open", a failed flush) hands the entry
  // back to the host's disk drain.
  useEffect(() => {
    const bridge = getBridge();
    const applier = createCaptureApplier({
      openPath: () => openNoteState().openPath,
      liveEditor: getLiveEditor,
      hasTransients: (editor) => hasTransientSuggestions(editor) || hasTransientAiState(editor),
      insertLine: insertCaptureLine,
      bufferContent: () => {
        // Loaded content only: while the controller is still reading the file
        // (path === null) an edit would no-op and a clean flush would ack
        // "applied" without persisting — report no buffer instead, so the
        // host's disk drain takes the capture and the reload shows it.
        const { editor } = openNoteState();
        return editor.path === null ? null : editor.content;
      },
      editBuffer: session.actions.editNote,
      flush: session.actions.flush,
      ack: (id, outcome) => {
        bridge.ackCapture({ id, outcome }).catch(() => {});
      },
      onApplied: () => toast.success("Captured to today's note"),
    });
    const unsubscribe = bridge.onCaptureApply(applier.apply);
    return () => {
      applier.dispose();
      unsubscribe();
    };
  }, [session]);

  // Expose the flush + open-note path to non-React callers (the voice
  // transcript path) so a dictated turn persists the open note AND tags the
  // agent with which file "this note" means — same as the typed composer. The
  // getters read the published state, so they stay correct without
  // re-registering per open.
  useEffect(() => {
    registerOpenNoteFlush(session.actions.flush);
    registerOpenNotePath(() => openNoteState().editor.path);
    // AI-path privacy read (fail-closed: indeterminate counts as private) —
    // agent-store omits the note-context hint for a private note. Reads the
    // live buffer, not the saved file, so a just-typed `private: true` is
    // honored on the very next send, and the buffer is the ONLY gate: this is a
    // leak-prevention gesture on the client, not a boundary the host enforces.
    registerOpenNotePrivacy(() => {
      const { editor } = openNoteState();
      if (editor.path === null) return true; // no note → nothing to attach anyway
      return notePrivacy(editor.content) !== "public";
    });
    return () => {
      registerOpenNoteFlush(null);
      registerOpenNotePath(null);
      registerOpenNotePrivacy(null);
    };
  }, [session]);

  const folderName = useMemo(() => {
    const cleaned = root.replace(/[/\\]+$/, "");
    return cleaned.split(/[/\\]/).pop() ?? cleaned;
  }, [root]);

  // Alias entries for the local resolver: the host's knowledge index owns alias
  // extraction; the client pulls WikiTargets (path + aliases) over the Bridge
  // so chips, transclusion, and autocomplete resolve `[[alias]]` exactly like
  // backlinks do. Refreshed on knowledge updates — the index lags saves
  // ~100-300ms, so a just-added alias resolves slightly late (same as the
  // backlinks panel).
  const [wikiTargets, setWikiTargets] = useState<WikiTarget[]>([]);
  const refreshWikiTargets = useCallback(() => {
    getBridge()
      .listWikiTargets()
      .then((targets) => {
        // Keep the previous reference when the payload is value-identical —
        // every autosave's knowledge pass re-emits the full list, and a fresh
        // array would rebuild the resolver + cascade a rerender for nothing.
        // (JSON compare is fine at wiki-target list size.)
        setWikiTargets((prev) =>
          JSON.stringify(prev) === JSON.stringify(targets) ? prev : targets,
        );
        return undefined;
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    refreshWikiTargets();
    return getBridge().onKnowledgeUpdated(() => refreshWikiTargets());
  }, [refreshWikiTargets]);

  // Wiki resolution over the live listing — same engine as the host's index, so
  // chips and the knowledge channels agree on what resolves. The listing stays
  // the path authority (aliases only fill the below-path tiers).
  const resolver = useMemo(() => {
    const aliasEntries: Array<readonly [string, string]> = [];
    for (const target of wikiTargets) {
      for (const alias of target.aliases ?? []) aliasEntries.push([alias, target.path]);
    }
    return buildResolver(
      entries.map((e) => e.path),
      aliasEntries,
    );
  }, [entries, wikiTargets]);
  const resolveWikiTarget = useCallback(
    (target: string) => resolver.resolveWiki(target),
    [resolver],
  );

  const listing = useMemo<VaultListing>(
    () => ({ entries, folderName, resolveWikiTarget }),
    [entries, folderName, resolveWikiTarget],
  );

  const host = useMemo<EditorHost>(
    () => ({ actions: session.actions, listing, ConnectionsPanel }),
    [session, listing],
  );

  return <EditorHostProvider host={host}>{children}</EditorHostProvider>;
}
