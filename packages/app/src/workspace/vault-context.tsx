import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { toast } from "@repo/ui/components/sonner";

import { getBridge } from "@repo/app/lib/bridge";
import { settleTransients } from "@repo/app/editor/ai/transient-settle";
import { registerOpenNoteFlush, registerOpenNotePath } from "@repo/app/workspace/open-note-flush";
import {
  type RawReason,
  analyzeMarkdown,
  toCanonical,
} from "@repo/app/editor/markdown/markdown-doc";
import {
  VaultEditorController,
  type VaultEditorState,
  type VaultIO,
} from "@repo/app/editor/vault-editor";
import {
  EMPTY_SESSION,
  activateTab as activateTabPure,
  closeTab as closeTabPure,
  cycleTab as cycleTabPure,
  openTab as openTabPure,
  parseSession,
  renameTab as renameTabPure,
  type TabSession,
} from "@repo/app/workspace/tab-session";
import { useUiStateStore } from "@repo/app/stores/ui-state-store";
import { useViewStore } from "@repo/app/stores/view-store";
import { buildResolver } from "@repo/core/knowledge/link-resolve";

// Files the rich (Plate) editor can render. `.mdx` is excluded — the Plate
// markdown pipeline doesn't round-trip MDX.
const MARKDOWN_RE = /\.(md|markdown)$/i;
import type { VaultEntry } from "@repo/core/ipc-registry";

const AUTOSAVE_DEBOUNCE_MS = 600;

/** ui-state key the open-tab session persists under (restored on boot). */
const TAB_SESSION_KEY = "workspace.tabs";

// IO the editor controllers act through — thin wrappers over the bridge so the
// controllers stay bridge-agnostic and unit-testable. A missing bridge throws,
// which a controller treats like any read/write failure.
const VAULT_IO: VaultIO = {
  read: (path) => {
    const bridge = getBridge();
    if (!bridge) throw new Error("Vault unavailable");
    return bridge.readVaultDoc({ path });
  },
  write: (path, content) => {
    const bridge = getBridge();
    if (!bridge) throw new Error("Vault unavailable");
    return bridge.writeVaultDoc({ path, content });
  },
  remove: (path) => {
    const bridge = getBridge();
    if (!bridge) throw new Error("Vault unavailable");
    return bridge.deleteVaultEntry({ path }).then(() => undefined);
  },
};

// The `editor` snapshot rendered while no tab is open. Root lives at the
// provider level (state below), so this can be a stable module constant.
const NO_TAB_STATE: VaultEditorState = {
  root: "",
  path: null,
  content: "",
  dirty: false,
  saving: false,
};
const noTabSubscribe = () => () => {};
const getNoTabState = () => NO_TAB_STATE;

/** One open tab's live machinery: its own editor controller (per-doc state),
 * its own autosave debounce, and the vanish watcher that closes the tab when
 * the file disappears out from under it. */
type TabRuntime = {
  controller: VaultEditorController;
  saveTimer: ReturnType<typeof setTimeout> | null;
  /** The controller has successfully loaded its path at least once — gates the
   * vanish watcher so the initial `path: null` state doesn't close the tab. */
  opened: boolean;
  unsubscribe: () => void;
};

export type OpenFileOptions = {
  /** Open in a new tab (Cmd/Ctrl-click) instead of replacing the active one. */
  newTab?: boolean;
};

type VaultContextValue = {
  /** Live editor session state of the ACTIVE tab (open file, content, dirty,
   * saving). A stable empty snapshot when no tab is open. */
  editor: VaultEditorState;
  /** Open tabs, in strip order (vault-relative paths). */
  tabs: readonly string[];
  /** The active tab's path (=== editor.path once its content is loaded). */
  activeTab: string | null;
  /** Flat listing of every file in the vault (the tree is derived from it). */
  entries: VaultEntry[];
  /** The vault root folder name (display only). */
  folderName: string;
  /** Open a file: activate its existing tab, else replace the active tab
   * (VS Code convention) — or append a new tab with `{ newTab: true }`.
   * Any pending edits on a replaced tab are flushed first. */
  openFile: (path: string, options?: OpenFileOptions) => void;
  /** Close a tab, flushing its unsaved edits first (a failed flush keeps the
   * tab open so nothing is lost). */
  closeTab: (path: string) => void;
  /** Make an already-open tab active. */
  activateTab: (path: string) => void;
  /** Ctrl+Tab / Ctrl+Shift+Tab — cycle the active tab. */
  cycleTab: (delta: 1 | -1) => void;
  /** Subscribe to one tab's controller (dirty-dot rendering). Fires on every
   * state change of that tab; returns an unsubscribe. */
  subscribeTab: (path: string, listener: () => void) => () => void;
  /** Whether a tab has unsaved edits (read inside a subscribeTab store). */
  isTabDirty: (path: string) => boolean;
  /** Record an edit to the active tab's buffer (debounced autosave). */
  onEdit: (content: string) => void;
  /** Record an edit to a SPECIFIC tab's buffer (debounced autosave). The
   * editor's teardown settle path (#374) routes through this — by the time an
   * unmounting editor settles a pending AI session, the active tab may
   * already have changed, so the bytes carry their own path. No-op when the
   * tab has no live runtime (e.g. it was deleted). */
  editTab: (path: string, content: string) => void;
  /** Create a file at `path` (e.g. "folder/note.md") and open it. */
  createFile: (path: string) => Promise<void>;
  /** Create an empty file WITHOUT opening it (wiki create-on-complete). An
   * existing file is left untouched and counts as success. */
  createFileAt: (path: string) => Promise<boolean>;
  /** Rename/move the file at `from` to `to`. Resolves `false` if the rename
   * failed (so callers like the title field can roll back their UI). */
  renameEntry: (from: string, to: string) => Promise<boolean>;
  /** Delete a file (closes its tab if open). */
  deleteEntry: (path: string) => Promise<void>;
  /** Pick a different vault folder. */
  changeFolder: () => Promise<void>;
  /** Persist the active tab's pending edits to disk now (e.g. before
   * delegating a checkbox). Resolves `true` once the buffer is clean. */
  flush: () => Promise<boolean>;
  /** Resolve a wiki target (`[[target]]`) against the current file listing —
   * the same Obsidian-style tiers the host's knowledge index uses. */
  resolveWikiTarget: (target: string) => string | null;

  // ---- Editor view (lifted so the header can own the controls) -------------
  /** Whether the open file is a markdown doc the rich editor can render. */
  isMarkdownOpen: boolean;
  /** Whether the open file is byte-canonical (rich editing leaves untouched
   * blocks byte-identical). Drives the "Format" tidy affordance. */
  canonical: boolean;
  /** Whether Rich editing is lossless (round-trip changes only formatting).
   * Drives whether Rich is offered/default — looser than `canonical`. */
  richSafe: boolean;
  /** Why the open file is Raw-only (parse error / out-of-vocabulary construct),
   * or null. Drives the header's Raw badge tooltip. */
  rawReason: RawReason | null;
  /** Raw (byte-exact textarea) vs Rich (Plate) editing surface. */
  mode: "raw" | "rich";
  setMode: (mode: "raw" | "rich") => void;
  /** Canonicalize the open doc so rich editing stays byte-stable, then switch
   * to Rich. */
  formatDoc: () => void;
};

const VaultContext = createContext<VaultContextValue | null>(null);

export function useVault(): VaultContextValue {
  const ctx = useContext(VaultContext);
  if (!ctx) throw new Error("useVault must be used within a VaultProvider");
  return ctx;
}

export function VaultProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [root, setRoot] = useState("");
  const rootRef = useRef("");

  // ---- Tab session ---------------------------------------------------------
  // The ref is the source of truth every operation reads and writes
  // SYNCHRONOUSLY; the state is its render mirror. Keeping mutations out of
  // setState updaters keeps them single-shot under StrictMode's double-invoke.
  const sessionRef = useRef<TabSession>(EMPTY_SESSION);
  const [session, setSession] = useState<TabSession>(EMPTY_SESSION);
  const runtimes = useRef(new Map<string, TabRuntime>());
  // Per-tab dirty-dot subscribers (keyed by path), fed by controller emits.
  const tabListeners = useRef(new Map<string, Set<() => void>>());
  const setUiState = useUiStateStore((s) => s.set);
  const uiLoaded = useUiStateStore((s) => s.loaded);

  const applySession = useCallback(
    (next: TabSession) => {
      if (next === sessionRef.current) return;
      sessionRef.current = next;
      setSession(next);
      setUiState(TAB_SESSION_KEY, { tabs: [...next.tabs], active: next.active });
    },
    [setUiState],
  );

  const notifyTab = useCallback((path: string) => {
    const listeners = tabListeners.current.get(path);
    if (listeners) for (const fn of listeners) fn();
  }, []);

  const disposeRuntime = useCallback((path: string) => {
    const runtime = runtimes.current.get(path);
    if (!runtime) return;
    if (runtime.saveTimer) clearTimeout(runtime.saveTimer);
    runtime.unsubscribe();
    runtimes.current.delete(path);
  }, []);

  /** Drop a tab without flushing — the file is already gone (external delete,
   * unreadable restore) or explicitly deleted. */
  const dropTab = useCallback(
    (path: string) => {
      disposeRuntime(path);
      applySession(closeTabPure(sessionRef.current, path));
    },
    [applySession, disposeRuntime],
  );
  const dropTabRef = useRef(dropTab);
  dropTabRef.current = dropTab;

  /** Create (if needed) the runtime for a tab and start loading its file. */
  const ensureRuntime = useCallback(
    (path: string): TabRuntime => {
      const existing = runtimes.current.get(path);
      if (existing) return existing;
      const controller = new VaultEditorController(VAULT_IO);
      controller.setRoot(rootRef.current);
      const runtime: TabRuntime = {
        controller,
        saveTimer: null,
        opened: false,
        unsubscribe: () => {},
      };
      runtime.unsubscribe = controller.subscribe(() => {
        const st = controller.getState();
        if (st.path === path) runtime.opened = true;
        // The file vanished under an open tab (deleted externally / removed) —
        // its tab closes rather than lingering over nothing.
        else if (runtime.opened && st.path === null) dropTabRef.current(path);
        notifyTab(path);
      });
      runtimes.current.set(path, runtime);
      void controller.open(path).then(() => {
        // Unreadable on first load (e.g. a restored tab whose file is gone) —
        // the tab never held content, so it silently closes.
        if (controller.getState().path !== path) dropTabRef.current(path);
        return undefined;
      });
      return runtime;
    },
    [notifyTab],
  );

  /** Flush one tab's pending edits (clearing its debounce). True when clean.
   * A pending AI suggestion session on this file is settled first (#374):
   * reject-all reverts only the suggestion-marked ranges, so typing the user
   * interleaved during the review persists while the AI marks disappear —
   * without this, the flush would write the frozen pre-session buffer and
   * the typing would die with the unmounting editor. */
  const flushTab = useCallback(async (path: string): Promise<boolean> => {
    const runtime = runtimes.current.get(path);
    if (!runtime) return true;
    const settled = settleTransients(path);
    if (settled !== null && settled !== runtime.controller.getState().content) {
      runtime.controller.edit(settled);
    }
    if (runtime.saveTimer) {
      clearTimeout(runtime.saveTimer);
      runtime.saveTimer = null;
    }
    await runtime.controller.flush();
    return !runtime.controller.getState().dirty;
  }, []);

  const openFile = useCallback(
    (path: string, options?: OpenFileOptions) => {
      void (async () => {
        // Navigation always lands on the editor surface — opening a note from
        // the graph, palette, or a wiki chip must show the note, not stay on
        // whatever surface was up.
        useViewStore.getState().setSurface("editor");
        const current = sessionRef.current;
        if (current.tabs.includes(path)) {
          applySession(activateTabPure(current, path));
          return;
        }
        const mode = options?.newTab ? "new" : "replace";
        // A plain open replaces the active tab — flush it first, and refuse to
        // navigate away from edits that won't save (same contract as before).
        const leaving = mode === "replace" ? current.active : null;
        if (leaving !== null && !(await flushTab(leaving))) {
          toast.error("Couldn't save the current file — resolve that before switching.");
          return;
        }
        const next = openTabPure(sessionRef.current, path, mode);
        for (const tab of sessionRef.current.tabs) {
          if (!next.tabs.includes(tab)) disposeRuntime(tab); // replaced (already flushed)
        }
        ensureRuntime(path);
        applySession(next);
      })();
    },
    [applySession, disposeRuntime, ensureRuntime, flushTab],
  );

  const closeTab = useCallback(
    (path: string) => {
      void (async () => {
        if (!sessionRef.current.tabs.includes(path)) return;
        // Closing a dirty tab flushes; a failed flush keeps the tab open so
        // the edits aren't dropped on the floor.
        if (!(await flushTab(path))) {
          toast.error("Couldn't save the file — resolve that before closing its tab.");
          return;
        }
        disposeRuntime(path);
        applySession(closeTabPure(sessionRef.current, path));
      })();
    },
    [applySession, disposeRuntime, flushTab],
  );

  const activateTab = useCallback(
    (path: string) => {
      useViewStore.getState().setSurface("editor");
      applySession(activateTabPure(sessionRef.current, path));
    },
    [applySession],
  );

  const cycleTab = useCallback(
    (delta: 1 | -1) => applySession(cycleTabPure(sessionRef.current, delta)),
    [applySession],
  );

  const subscribeTab = useCallback((path: string, listener: () => void) => {
    let set = tabListeners.current.get(path);
    if (!set) {
      set = new Set();
      tabListeners.current.set(path, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) tabListeners.current.delete(path);
    };
  }, []);

  const isTabDirty = useCallback((path: string): boolean => {
    return runtimes.current.get(path)?.controller.getState().dirty ?? false;
  }, []);

  // ---- Active-tab editor state ---------------------------------------------
  const activeRuntime = session.active !== null ? runtimes.current.get(session.active) : undefined;
  const activeController = activeRuntime?.controller ?? null;
  const editor = useSyncExternalStore(
    activeController ? activeController.subscribe : noTabSubscribe,
    activeController ? activeController.getState : getNoTabState,
  );

  // Ordering token so overlapping list calls (initial load + onVaultChanged, or
  // rapid vault events) can't land out of order — only the latest applies.
  const listSeq = useRef(0);
  const refreshList = useCallback(() => {
    const bridge = getBridge();
    if (!bridge) return;
    const seq = ++listSeq.current;
    void (async () => {
      try {
        const next = await bridge.listVault();
        if (seq === listSeq.current) setEntries(next);
      } catch {
        // Best-effort — keep the last-known listing on a transient failure.
      }
    })();
  }, []);

  const editTab = useCallback((path: string, next: string) => {
    const runtime = runtimes.current.get(path);
    if (!runtime) return;
    runtime.controller.edit(next);
    if (runtime.saveTimer) clearTimeout(runtime.saveTimer);
    runtime.saveTimer = setTimeout(() => {
      runtime.saveTimer = null;
      void runtime.controller.flush();
    }, AUTOSAVE_DEBOUNCE_MS);
  }, []);

  const onEdit = useCallback(
    (next: string) => {
      const active = sessionRef.current.active;
      if (active !== null) editTab(active, next);
    },
    [editTab],
  );

  const createFileAt = useCallback(
    async (rawPath: string): Promise<boolean> => {
      const trimmed = rawPath.trim();
      if (!trimmed) return false;
      const path = /\.[a-z0-9]+$/i.test(trimmed) ? trimmed : `${trimmed}.md`;
      const bridge = getBridge();
      if (!bridge) return false;
      // Don't truncate an existing file — it already satisfies "exists".
      const exists = await bridge
        .readVaultDoc({ path })
        .then(() => true)
        .catch(() => false);
      if (exists) return true;
      const created = await bridge
        .writeVaultDoc({ path, content: "" })
        .then(() => true)
        .catch(() => false);
      if (created) refreshList();
      else toast.error(`Couldn't create ${path}.`);
      return created;
    },
    [refreshList],
  );

  const createFile = useCallback(
    async (rawPath: string) => {
      const trimmed = rawPath.trim();
      if (!trimmed) return;
      const path = /\.[a-z0-9]+$/i.test(trimmed) ? trimmed : `${trimmed}.md`;
      if (await createFileAt(path)) openFile(path);
    },
    [createFileAt, openFile],
  );

  const renameEntry = useCallback(
    async (from: string, to: string): Promise<boolean> => {
      const dest = to.trim();
      if (!dest || dest === from) return true; // nothing to do
      const bridge = getBridge();
      if (!bridge) return false;
      // Flush first so an in-flight write of `from` can't recreate it post-move.
      if (!(await flushTab(from))) {
        toast.error("Couldn't save the file — resolve that before renaming.");
        return false;
      }
      // Dispose `from`'s runtime BEFORE the bridge call: the rename's
      // vault-changed broadcast otherwise races the remap below — the old
      // controller reloads the now-missing source path, lands on path: null,
      // and the vanish watcher closes the very tab we're carrying over.
      const wasOpen = sessionRef.current.tabs.includes(from);
      if (wasOpen) disposeRuntime(from);
      const result = await bridge.renameVaultEntry({ from, to: dest }).catch(() => null);
      if (!result || !result.ok) {
        toast.error(result?.ok === false ? result.error : "Couldn't rename the file.");
        // The file never moved — re-attach a controller to the still-open tab.
        if (wasOpen && sessionRef.current.tabs.includes(from)) ensureRuntime(from);
        return false;
      }
      refreshList();
      // Carry the tab to the new path: same strip position, fresh controller
      // reading the moved file (the old one was flushed + disposed above).
      if (sessionRef.current.tabs.includes(from)) {
        const next = renameTabPure(sessionRef.current, from, dest);
        ensureRuntime(dest);
        applySession(next);
      }
      return true;
    },
    [applySession, disposeRuntime, ensureRuntime, flushTab, refreshList],
  );

  const deleteEntry = useCallback(
    async (path: string) => {
      const runtime = runtimes.current.get(path);
      if (runtime) {
        if (runtime.saveTimer) {
          clearTimeout(runtime.saveTimer);
          runtime.saveTimer = null;
        }
        // remove() emits path:null, which the vanish watcher turns into a
        // dropped tab; the explicit drop below is an idempotent backstop.
        await runtime.controller.remove();
        dropTab(path);
      } else {
        const bridge = getBridge();
        if (!bridge) return;
        await bridge.deleteVaultEntry({ path }).catch(() => undefined);
      }
      refreshList();
    },
    [dropTab, refreshList],
  );

  const changeFolder = useCallback(async () => {
    for (const path of sessionRef.current.tabs) {
      if (!(await flushTab(path))) {
        toast.error("Couldn't save every open file — resolve that before switching folders.");
        return;
      }
    }
    const bridge = getBridge();
    if (!bridge) return;
    const result = await bridge.chooseVaultRoot().catch(() => null);
    if (!result) return;
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    if ("root" in result) {
      rootRef.current = result.root;
      setRoot(result.root);
      // disposeRuntime only deletes the key being visited — safe mid-iteration.
      for (const path of runtimes.current.keys()) disposeRuntime(path);
      applySession(EMPTY_SESSION);
      refreshList();
    }
  }, [applySession, disposeRuntime, flushTab, refreshList]);

  const flush = useCallback(async (): Promise<boolean> => {
    const active = sessionRef.current.active;
    return active === null ? true : flushTab(active);
  }, [flushTab]);

  // Initial load: adopt the root + list files.
  useEffect(() => {
    getBridge()
      ?.getVaultRoot()
      .then((r) => {
        rootRef.current = r;
        setRoot(r);
        for (const runtime of runtimes.current.values()) runtime.controller.setRoot(r);
        return undefined;
      })
      .catch(() => {});
    refreshList();
  }, [refreshList]);

  // Restore the persisted tab session once ui-state has loaded — but never
  // over tabs the user already opened while it was loading.
  const restored = useRef(false);
  useEffect(() => {
    if (!uiLoaded || restored.current) return;
    restored.current = true;
    if (sessionRef.current.tabs.length > 0) return;
    const stored = parseSession(useUiStateStore.getState().values[TAB_SESSION_KEY]);
    if (!stored || stored.tabs.length === 0) return;
    for (const path of stored.tabs) ensureRuntime(path);
    sessionRef.current = stored;
    setSession(stored);
  }, [uiLoaded, ensureRuntime]);

  // Live updates: hand every vault-changed broadcast to every tab's controller
  // (reload or drop) and re-list the tree. A real root switch drops all tabs —
  // their relative paths belong to the old vault.
  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) return;
    return bridge.onVaultChanged(({ root: nextRoot }) => {
      const switched = rootRef.current !== "" && nextRoot !== rootRef.current;
      rootRef.current = nextRoot;
      setRoot(nextRoot);
      if (switched) {
        for (const path of runtimes.current.keys()) disposeRuntime(path);
        applySession(EMPTY_SESSION);
      } else {
        for (const runtime of runtimes.current.values()) {
          runtime.controller.externalChange(nextRoot);
        }
      }
      refreshList();
    });
  }, [applySession, disposeRuntime, refreshList]);

  // Persist on unmount so a change within the debounce window isn't lost.
  useEffect(
    () => () => {
      for (const runtime of runtimes.current.values()) void runtime.controller.flush();
    },
    [],
  );

  // Expose the flush + open-note path to non-React callers (the voice transcript
  // path) so a dictated turn persists the open note AND tags the agent with which
  // file "this note" means — same as the typed composer. The path getter reads
  // the live session, so it stays correct without re-registering per open.
  useEffect(() => {
    registerOpenNoteFlush(flush);
    registerOpenNotePath(() => {
      const active = sessionRef.current.active;
      return active !== null
        ? (runtimes.current.get(active)?.controller.getState().path ?? null)
        : null;
    });
    return () => {
      registerOpenNoteFlush(null);
      registerOpenNotePath(null);
    };
  }, [flush]);

  const folderName = useMemo(() => {
    const cleaned = root.replace(/[/\\]+$/, "");
    return cleaned.split(/[/\\]/).pop() ?? cleaned;
  }, [root]);

  // Wiki resolution over the live listing — same engine as the host's index,
  // so chips and the knowledge channels agree on what resolves.
  const resolver = useMemo(() => buildResolver(entries.map((e) => e.path)), [entries]);
  const resolveWikiTarget = useCallback(
    (target: string) => resolver.resolveWiki(target),
    [resolver],
  );

  // ---- Editor view (mode + canonicality) ----------------------------------
  const isMarkdownOpen = editor.path !== null && MARKDOWN_RE.test(editor.path);
  const [mode, setMode] = useState<"raw" | "rich">("raw");
  // Analysis is derived state kept in LOCKSTEP with (path, content) within a
  // single render — the state-adjustment-during-render pattern. Recomputing in
  // an effect committed one frame where a freshly opened Raw-only file still
  // wore the PREVIOUS file's richSafe: the rich editor mounted against
  // unparseable bytes (console error + a throwaway editor instance) before
  // the effect corrected the gate. Adjusting state during render re-renders
  // before any child mounts, so the gate and the content can never disagree.
  const [analyzed, setAnalyzed] = useState<{
    analysis: ReturnType<typeof analyzeMarkdown>;
    content: string;
    path: string | null;
  }>({
    analysis: { canonical: false, rawReason: null, richSafe: false },
    content: "",
    path: null,
  });
  // While the buffer is dirty (mid-typing, pre-autosave) the last analysis is
  // intentionally retained — one parse+serialize pass per SAVED content change
  // (badges + the `showRich` gate), not per keystroke.
  const pathChanged = analyzed.path !== editor.path;
  if ((pathChanged || analyzed.content !== editor.content) && !editor.dirty) {
    const analysis = isMarkdownOpen
      ? analyzeMarkdown(editor.content)
      : { canonical: false, rawReason: null, richSafe: false };
    setAnalyzed({ analysis, content: editor.content, path: editor.path });
    // The mode (raw/rich) is the user's choice, picked once per file open — a
    // post-save flush (dirty→false, content unchanged) and an external/agent
    // reload of the same file must not yank the user out of the surface they
    // picked. (`showRich` also requires `richSafe`, so a file that turns
    // non-rich-safe out from under us still falls back to raw regardless.)
    if (pathChanged) setMode(analysis.richSafe ? "rich" : "raw");
  }
  const analysis = analyzed.analysis;

  const formatDoc = useCallback(() => {
    // Only reachable when the header offered Format (parse+scan ok, not
    // canonical) — toCanonical throws on unparseable content by contract.
    const canonical = toCanonical(editor.content);
    onEdit(canonical);
    setAnalyzed({
      analysis: { canonical: true, rawReason: null, richSafe: true },
      content: canonical,
      path: editor.path,
    });
    setMode("rich");
  }, [onEdit, editor.content, editor.path]);

  const value = useMemo<VaultContextValue>(
    () => ({
      editor,
      tabs: session.tabs,
      activeTab: session.active,
      entries,
      folderName,
      openFile,
      closeTab,
      activateTab,
      cycleTab,
      subscribeTab,
      isTabDirty,
      onEdit,
      editTab,
      createFile,
      createFileAt,
      renameEntry,
      deleteEntry,
      changeFolder,
      flush,
      resolveWikiTarget,
      isMarkdownOpen,
      canonical: analysis.canonical,
      richSafe: analysis.richSafe,
      rawReason: analysis.rawReason,
      mode,
      setMode,
      formatDoc,
    }),
    [
      editor,
      session,
      entries,
      folderName,
      openFile,
      closeTab,
      activateTab,
      cycleTab,
      subscribeTab,
      isTabDirty,
      onEdit,
      editTab,
      createFile,
      createFileAt,
      renameEntry,
      deleteEntry,
      changeFolder,
      flush,
      resolveWikiTarget,
      isMarkdownOpen,
      analysis,
      mode,
      formatDoc,
    ],
  );

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}
