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

import { docExists, getBridge } from "@renderer/lib/bridge";
import { createDebouncer } from "@renderer/lib/debounce";
import { settleTransients } from "@renderer/editor/ai/transient-settle";
import { registerOpenNoteFlush, registerOpenNotePath } from "@renderer/workspace/open-note-flush";
import { type RawReason, parseMarkdown } from "@renderer/editor/markdown/markdown-doc";
import { type NoteRuntime, createNoteRuntime } from "@renderer/workspace/note-runtime";
import { type VaultEditorState, type VaultIO } from "@renderer/editor/vault-editor";
import { useUiStateStore } from "@renderer/stores/ui-state-store";
import { useViewStore } from "@renderer/stores/view-store";
import { buildResolver } from "@repo/core/knowledge/link-resolve";

// Files the rich (Plate) editor can render. `.mdx` is excluded — the Plate
// markdown pipeline doesn't round-trip MDX.
const MARKDOWN_RE = /\.(md|markdown)$/i;
const HTML_RE = /\.html$/i;
import type { VaultEntry } from "@repo/features/ipc-registry";

/** ui-state key the open note persists under (restored on boot). */
const OPEN_NOTE_KEY = "workspace.openNote";

/** Debounce window-focus → vault refresh so a flurry of focus/blur (alt-tab,
 * dialogs) coalesces into one snapshot rebuild (ADR-0001). */
const FOCUS_REFRESH_DEBOUNCE_MS = 1000;

/**
 * Append the default `.md` extension unless `name` already ends in one (any
 * lowercase-alphanumeric extension). `name` is assumed already trimmed.
 */
function withDefaultExtension(name: string): string {
  return /\.[a-z0-9]+$/i.test(name) ? name : `${name}.md`;
}

// IO the editor controller acts through — thin wrappers over the bridge so the
// controller stays bridge-agnostic and unit-testable. A missing bridge throws,
// which the controller treats like any read/write failure.
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

// The `editor` snapshot rendered while no note is open. Root lives at the
// provider level (state below), so this can be a stable module constant.
const NO_NOTE_STATE: VaultEditorState = {
  root: "",
  path: null,
  content: "",
  dirty: false,
  saving: false,
};
const noNoteSubscribe = () => () => {};
const getNoNoteState = () => NO_NOTE_STATE;

type VaultContextValue = {
  /** Live editor session state of the open note (file, content, dirty,
   * saving). A stable empty snapshot when no note is open. */
  editor: VaultEditorState;
  /** The open note's path (=== editor.path once its content is loaded). */
  openPath: string | null;
  /** Flat listing of every file in the vault (the tree is derived from it). */
  entries: VaultEntry[];
  /** The vault root folder name (display only). */
  folderName: string;
  /** Open a file, replacing the current note. Pending edits on the current
   * note are flushed first; a failed flush refuses to navigate. */
  openFile: (path: string) => void;
  /** Record an edit to a SPECIFIC note's buffer (debounced autosave). Bytes
   * always carry the path of the editor that produced them: teardown settles
   * (#374) and surface switches can emit after the open note already changed,
   * and those bytes must no-op rather than land on the wrong file. */
  editNote: (path: string, content: string) => void;
  /** Register a SPECIFIC note's pre-flush hook on its runtime (the Rich
   * editor's serialize flush — drains a keystroke still in the serialize
   * debounce into the buffer before any save/rename/delete persists it).
   * Routed by path like editNote: a registration from an editor whose note
   * already closed must not land on the next note's runtime. */
  registerNoteSerializeFlush: (path: string, flush: () => void) => void;
  /** Create a file at `path` (e.g. "folder/note.md") and open it. */
  createFile: (path: string) => Promise<void>;
  /** Create an empty file WITHOUT opening it (wiki create-on-complete). An
   * existing file is left untouched and counts as success. */
  createFileAt: (path: string) => Promise<boolean>;
  /** Open the note at `path`; if it doesn't exist yet, create it seeded with
   * `content` (byte-exact) FIRST, then open it. An existing file is opened
   * untouched — this is the open-or-create used by templates + daily notes, so
   * re-running it never clobbers a note the user already has. */
  openOrCreateNote: (path: string, content: string) => Promise<void>;
  /** Rename/move the file at `from` to `to`. Resolves `false` if the rename
   * failed (so callers like the title field can roll back their UI). */
  renameEntry: (from: string, to: string) => Promise<boolean>;
  /** Delete a file (closes it if open). */
  deleteEntry: (path: string) => Promise<void>;
  /** Pick a different vault folder. */
  changeFolder: () => Promise<void>;
  /** Persist the open note's pending edits to disk now (e.g. before
   * delegating a checkbox). Resolves `true` once the buffer is clean. */
  flush: () => Promise<boolean>;
  /** Resolve a wiki target (`[[target]]`) against the current file listing —
   * the same Obsidian-style tiers the host's knowledge index uses. */
  resolveWikiTarget: (target: string) => string | null;
  /** Rebuild the ephemeral vault snapshot now (re-list + reindex + sync kick).
   * The command palette's "Refresh vault" invokes this; window focus does too,
   * debounced (ADR-0001). */
  refreshVault: () => void;

  // ---- Editor view (lifted so the header can own the controls) -------------
  /** Whether the open file is a markdown doc the rich editor can render. */
  isMarkdownOpen: boolean;
  /** Whether Rich editing is available: the file parses within the vocabulary.
   * Rich normalizes formatting on the first real edit — only files the
   * pipeline can't represent at all (rawReason) are Raw-only. */
  richAvailable: boolean;
  /** Why the open file is Raw-only (parse error / out-of-vocabulary construct),
   * or null. Drives the header's Raw badge tooltip. */
  rawReason: RawReason | null;
  /** Raw (byte-exact textarea) vs Rich (Plate) editing surface. */
  mode: "raw" | "rich";
  setMode: (mode: "raw" | "rich") => void;

  // ---- HTML Apps -----------------------------------------------------------
  /** Whether the open file is a vault `.html` file (renderable as an app). */
  openIsHtml: boolean;
  /** Whether to show the open `.html` as a sandboxed app (vs. as raw text). App
   * is the default on open; "Open as text" flips it. Only meaningful when
   * `openIsHtml`. */
  isHtmlApp: boolean;
  /** Show the open `.html` as raw text in the editor ("Open as text"). */
  showHtmlAsText: () => void;
  /** Show the open `.html` as a sandboxed app again ("Open as app"). */
  showHtmlAsApp: () => void;
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

  // ---- Open note -----------------------------------------------------------
  // The ref is the source of truth every operation reads and writes
  // SYNCHRONOUSLY; the state is its render mirror. Keeping mutations out of
  // setState updaters keeps them single-shot under StrictMode's double-invoke.
  const openPathRef = useRef<string | null>(null);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const runtimeRef = useRef<NoteRuntime | null>(null);
  const setUiState = useUiStateStore((s) => s.set);
  const uiLoaded = useUiStateStore((s) => s.loaded);
  // Per-open view choice for `.html` files: app (default) vs. raw text. Reset
  // on every open so a new `.html` always starts as an app.
  const [htmlAsText, setHtmlAsText] = useState(false);

  const applyOpenPath = useCallback(
    (next: string | null) => {
      if (next === openPathRef.current) return;
      openPathRef.current = next;
      setOpenPath(next);
      setHtmlAsText(false);
      setUiState(OPEN_NOTE_KEY, next);
      // Point the host's single open-note watcher at the new file (or clear it).
      // This is the only file watched for external edits (ADR-0001).
      getBridge()
        ?.setWatchedNote({ path: next })
        .catch(() => {});
    },
    [setUiState],
  );

  const disposeRuntime = useCallback(() => {
    runtimeRef.current?.dispose();
    runtimeRef.current = null;
  }, []);

  /** Drop the open note without flushing — the file is already gone (external
   * delete, unreadable restore) or explicitly deleted. */
  const dropNote = useCallback(
    (path: string) => {
      if (runtimeRef.current?.path !== path) return;
      disposeRuntime();
      applyOpenPath(null);
    },
    [applyOpenPath, disposeRuntime],
  );
  const dropNoteRef = useRef(dropNote);
  dropNoteRef.current = dropNote;

  /** Create the runtime for a note and start loading its file. Any previous
   * runtime must already be disposed (openFile owns that ordering). */
  const ensureRuntime = useCallback((path: string): NoteRuntime => {
    const existing = runtimeRef.current;
    if (existing?.path === path) return existing;
    const runtime = createNoteRuntime(path, rootRef.current, VAULT_IO, {
      onVanished: (p) => dropNoteRef.current(p),
    });
    runtimeRef.current = runtime;
    return runtime;
  }, []);

  /** Flush the open note's pending edits (clearing the debounce). True when
   * clean. A pending AI suggestion session on the file is settled first
   * (#374): reject-all reverts only the suggestion-marked ranges, so typing
   * the user interleaved during the review persists while the AI marks
   * disappear — without this, the flush would write the frozen pre-session
   * buffer and the typing would die with the unmounting editor. */
  const flushCurrent = useCallback(async (): Promise<boolean> => {
    const runtime = runtimeRef.current;
    if (!runtime) return true;
    const settled = settleTransients(runtime.path);
    if (settled !== null && settled !== runtime.controller.getState().content) {
      runtime.controller.edit(settled);
    }
    return runtime.flush();
  }, []);

  const openFile = useCallback(
    (path: string) => {
      void (async () => {
        // Navigation always lands on the editor surface — opening a note from
        // the graph, palette, or a wiki chip must show the note, not stay on
        // whatever surface was up.
        useViewStore.getState().setSurface("editor");
        if (openPathRef.current === path) return;
        // Flush the current note first, and refuse to navigate away from
        // edits that won't save (same contract as before).
        if (!(await flushCurrent())) {
          toast.error("Couldn't save the current file — resolve that before switching.");
          return;
        }
        disposeRuntime();
        ensureRuntime(path);
        applyOpenPath(path);
      })();
    },
    [applyOpenPath, disposeRuntime, ensureRuntime, flushCurrent],
  );

  // ---- Open-note editor state ----------------------------------------------
  const activeController = openPath !== null ? (runtimeRef.current?.controller ?? null) : null;
  const editor = useSyncExternalStore(
    activeController ? activeController.subscribe : noNoteSubscribe,
    activeController ? activeController.getState : getNoNoteState,
  );

  // Ordering token so overlapping list calls (initial load + onVaultChanged, or
  // rapid vault events) can't land out of order — only the latest applies.
  const listSeq = useRef(0);
  // Last-applied listing, in a ref so the async callback compares against the
  // truly latest value (React state would be a stale closure). Every vault
  // broadcast re-fetches the listing — focus refreshes, delegation completion,
  // external open-note edits (autosaves went silent with ADR-0001) — and most
  // of those don't change the listing, so skip the state set when nothing
  // structural changed to keep the sidebar tree from re-rendering on refocus.
  const lastEntriesRef = useRef<VaultEntry[]>([]);
  const refreshList = useCallback(() => {
    const bridge = getBridge();
    if (!bridge) return;
    const seq = ++listSeq.current;
    void (async () => {
      try {
        const next = await bridge.listVault();
        if (seq !== listSeq.current) return;
        const prev = lastEntriesRef.current;
        const same =
          next.length === prev.length &&
          next.every((entry, i) => {
            const before = prev[i];
            return (
              before !== undefined &&
              entry.path === before.path &&
              entry.name === before.name &&
              entry.kind === before.kind
            );
          });
        if (same) return;
        lastEntriesRef.current = next;
        setEntries(next);
      } catch {
        // Best-effort — keep the last-known listing on a transient failure.
      }
    })();
  }, []);

  const editNote = useCallback((path: string, next: string) => {
    const runtime = runtimeRef.current;
    if (runtime?.path !== path) return;
    runtime.edit(next);
  }, []);

  const registerNoteSerializeFlush = useCallback((path: string, flush: () => void) => {
    const runtime = runtimeRef.current;
    if (runtime?.path !== path) return;
    runtime.registerPreFlush(flush);
  }, []);

  const createFileAt = useCallback(
    async (rawPath: string): Promise<boolean> => {
      const trimmed = rawPath.trim();
      if (!trimmed) return false;
      const path = withDefaultExtension(trimmed);
      const bridge = getBridge();
      if (!bridge) return false;
      // Don't truncate an existing file — it already satisfies "exists".
      if (await docExists(bridge, path)) return true;
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
      const path = withDefaultExtension(trimmed);
      if (await createFileAt(path)) openFile(path);
    },
    [createFileAt, openFile],
  );

  const openOrCreateNote = useCallback(
    async (rawPath: string, content: string) => {
      const trimmed = rawPath.trim();
      if (!trimmed) return;
      const path = withDefaultExtension(trimmed);
      const bridge = getBridge();
      if (!bridge) return;
      // Open-or-create: only write (seed) when the file is genuinely new, so a
      // second "open today's note" reopens the existing note byte-for-byte.
      if (!(await docExists(bridge, path))) {
        const created = await bridge
          .writeVaultDoc({ path, content })
          .then(() => true)
          .catch(() => false);
        if (!created) {
          toast.error(`Couldn't create ${path}.`);
          return;
        }
        refreshList();
      }
      openFile(path);
    },
    [openFile, refreshList],
  );

  const renameEntry = useCallback(
    async (from: string, to: string): Promise<boolean> => {
      const dest = to.trim();
      if (!dest || dest === from) return true; // nothing to do
      const bridge = getBridge();
      if (!bridge) return false;
      const wasOpen = openPathRef.current === from;
      // Flush first so an in-flight write of `from` can't recreate it post-move.
      if (wasOpen && !(await flushCurrent())) {
        toast.error("Couldn't save the file — resolve that before renaming.");
        return false;
      }
      // Dispose `from`'s runtime BEFORE the bridge call: the rename's
      // vault-changed broadcast otherwise races the remap below — the old
      // controller reloads the now-missing source path, lands on path: null,
      // and the vanish watcher closes the very note we're carrying over.
      if (wasOpen) disposeRuntime();
      const result = await bridge.renameVaultEntry({ from, to: dest }).catch(() => null);
      if (!result || !result.ok) {
        toast.error(result?.ok === false ? result.error : "Couldn't rename the file.");
        // The file never moved — re-attach a controller to the still-open note.
        if (wasOpen && openPathRef.current === from) ensureRuntime(from);
        return false;
      }
      refreshList();
      // Carry the open note to the new path: a fresh controller reading the
      // moved file (the old one was flushed + disposed above).
      if (wasOpen && openPathRef.current === from) {
        ensureRuntime(dest);
        applyOpenPath(dest);
      }
      return true;
    },
    [applyOpenPath, disposeRuntime, ensureRuntime, flushCurrent, refreshList],
  );

  const deleteEntry = useCallback(
    async (path: string) => {
      const runtime = runtimeRef.current;
      if (runtime?.path === path) {
        // remove() emits path:null, which the vanish watcher turns into a
        // dropped note; the explicit drop below is an idempotent backstop.
        await runtime.remove();
        dropNote(path);
      } else {
        const bridge = getBridge();
        if (!bridge) return;
        await bridge.deleteVaultEntry({ path }).catch(() => undefined);
      }
      refreshList();
    },
    [dropNote, refreshList],
  );

  const changeFolder = useCallback(async () => {
    if (!(await flushCurrent())) {
      toast.error("Couldn't save the open file — resolve that before switching folders.");
      return;
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
      disposeRuntime();
      applyOpenPath(null);
      refreshList();
    }
  }, [applyOpenPath, disposeRuntime, flushCurrent, refreshList]);

  const flush = useCallback((): Promise<boolean> => flushCurrent(), [flushCurrent]);

  const refreshVault = useCallback(() => {
    getBridge()
      ?.refreshVault()
      .catch(() => {});
  }, []);

  // Initial load: adopt the root + list files.
  useEffect(() => {
    getBridge()
      ?.getVaultRoot()
      .then((r) => {
        rootRef.current = r;
        setRoot(r);
        runtimeRef.current?.controller.setRoot(r);
        return undefined;
      })
      .catch(() => {});
    refreshList();
  }, [refreshList]);

  // Restore the persisted open note once ui-state has loaded — but never over
  // a note the user already opened while it was loading.
  const restored = useRef(false);
  useEffect(() => {
    if (!uiLoaded || restored.current) return;
    restored.current = true;
    if (openPathRef.current !== null) return;
    const stored = useUiStateStore.getState().values[OPEN_NOTE_KEY];
    if (typeof stored !== "string" || stored === "") return;
    ensureRuntime(stored);
    applyOpenPath(stored);
  }, [uiLoaded, ensureRuntime, applyOpenPath]);

  // Live updates: hand every vault-changed broadcast to the open note's
  // controller (reload or drop) and re-list the tree. A real root switch drops
  // the note — its relative path belongs to the old vault.
  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) return;
    return bridge.onVaultChanged(({ root: nextRoot }) => {
      const switched = rootRef.current !== "" && nextRoot !== rootRef.current;
      rootRef.current = nextRoot;
      setRoot(nextRoot);
      if (switched) {
        disposeRuntime();
        applyOpenPath(null);
      } else {
        runtimeRef.current?.controller.externalChange(nextRoot);
      }
      refreshList();
    });
  }, [applyOpenPath, disposeRuntime, refreshList]);

  // External edits to files OTHER than the open note surface on window focus —
  // the ephemeral model's "the user refocuses to look" trade (ADR-0001). One
  // debounced refresh per focus flurry rebuilds the snapshot (re-list + reindex
  // + sync kick). The open note itself is covered live by the host's open-note
  // watcher, so this is about the rest of the vault.
  useEffect(() => {
    const refresh = createDebouncer(refreshVault, FOCUS_REFRESH_DEBOUNCE_MS);
    const onFocus = () => refresh.schedule();
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      refresh.cancel();
    };
  }, [refreshVault]);

  // Persist on unmount so a change within the debounce window isn't lost.
  useEffect(
    () => () => {
      void runtimeRef.current?.flush();
    },
    [],
  );

  // Expose the flush + open-note path to non-React callers (the voice transcript
  // path) so a dictated turn persists the open note AND tags the agent with which
  // file "this note" means — same as the typed composer. The path getter reads
  // the live runtime, so it stays correct without re-registering per open.
  useEffect(() => {
    registerOpenNoteFlush(flush);
    registerOpenNotePath(() => runtimeRef.current?.controller.getState().path ?? null);
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

  // ---- Editor view (mode + parseability) -----------------------------------
  const isMarkdownOpen = editor.path !== null && MARKDOWN_RE.test(editor.path);
  const [mode, setMode] = useState<"raw" | "rich">("raw");
  // Analysis is derived state kept in LOCKSTEP with (path, content) within a
  // single render — the state-adjustment-during-render pattern. Recomputing in
  // an effect committed one frame where a freshly opened Raw-only file still
  // wore the PREVIOUS file's verdict: the rich editor mounted against
  // unparseable bytes (console error + a throwaway editor instance) before
  // the effect corrected the gate. Adjusting state during render re-renders
  // before any child mounts, so the gate and the content can never disagree.
  const [analyzed, setAnalyzed] = useState<{
    rawReason: RawReason | null;
    content: string;
    path: string | null;
  }>({ rawReason: null, content: "", path: null });
  // While the buffer is dirty (mid-typing, pre-autosave) the last analysis is
  // intentionally retained — one parse pass per SAVED content change (the Raw
  // badge + the `showRich` gate), not per keystroke.
  const pathChanged = analyzed.path !== editor.path;
  if ((pathChanged || analyzed.content !== editor.content) && !editor.dirty) {
    // Rich is the default surface: any file that parses within the vocabulary
    // opens rich (normalizing on the first real edit); only genuinely
    // unrepresentable content (unknown JSX, parse errors) is Raw-only.
    const parsed =
      isMarkdownOpen && editor.content.trim() !== "" ? parseMarkdown(editor.content) : null;
    const rawReason = parsed !== null && !parsed.ok ? parsed.reason : null;
    setAnalyzed({ rawReason, content: editor.content, path: editor.path });
    // The mode (raw/rich) is the user's choice, picked once per file open — a
    // post-save flush (dirty→false, content unchanged) and an external/agent
    // reload of the same file must not yank the user out of the surface they
    // picked. (`showRich` also requires `richAvailable`, so a file that turns
    // unparseable out from under us still falls back to raw regardless.)
    if (pathChanged) setMode(isMarkdownOpen && rawReason === null ? "rich" : "raw");
  }
  const richAvailable = isMarkdownOpen && analyzed.rawReason === null;

  // ---- HTML Apps -----------------------------------------------------------
  const openIsHtml = openPath !== null && HTML_RE.test(openPath);
  const isHtmlApp = openIsHtml && !htmlAsText;
  const showHtmlAsText = useCallback(() => setHtmlAsText(true), []);
  const showHtmlAsApp = useCallback(() => setHtmlAsText(false), []);

  const value = useMemo<VaultContextValue>(
    () => ({
      editor,
      openPath,
      entries,
      folderName,
      openFile,
      editNote,
      registerNoteSerializeFlush,
      createFile,
      createFileAt,
      openOrCreateNote,
      renameEntry,
      deleteEntry,
      changeFolder,
      flush,
      resolveWikiTarget,
      refreshVault,
      isMarkdownOpen,
      richAvailable,
      rawReason: analyzed.rawReason,
      mode,
      setMode,
      openIsHtml,
      isHtmlApp,
      showHtmlAsText,
      showHtmlAsApp,
    }),
    [
      editor,
      openPath,
      entries,
      folderName,
      openFile,
      editNote,
      registerNoteSerializeFlush,
      createFile,
      createFileAt,
      openOrCreateNote,
      renameEntry,
      deleteEntry,
      changeFolder,
      flush,
      resolveWikiTarget,
      refreshVault,
      isMarkdownOpen,
      richAvailable,
      analyzed.rawReason,
      mode,
      openIsHtml,
      isHtmlApp,
      showHtmlAsText,
      showHtmlAsApp,
    ],
  );

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}
