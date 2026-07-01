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

import { getBridge } from "@/renderer/lib/bridge";
import { registerOpenNoteFlush, registerOpenNotePath } from "@/renderer/workspace/open-note-flush";
import { isCanonical, isRichSafe, toCanonical } from "@/renderer/editor/markdown-doc";
import {
  VaultEditorController,
  type VaultEditorState,
  type VaultIO,
} from "@/renderer/editor/vault-editor";

// Files the rich (Plate) editor can render. `.mdx` is excluded — the Plate
// markdown pipeline doesn't round-trip MDX.
const MARKDOWN_RE = /\.(md|markdown)$/i;
import type { VaultEntry } from "@/shared/ipc-registry";

const AUTOSAVE_DEBOUNCE_MS = 600;

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

type VaultContextValue = {
  /** Live editor session state (open file, content, dirty, saving). */
  editor: VaultEditorState;
  /** Flat listing of every file in the vault (the tree is derived from it). */
  entries: VaultEntry[];
  /** The vault root folder name (display only). */
  folderName: string;
  /** Open a file, autosaving any pending edits first. */
  openFile: (path: string) => void;
  /** Record an edit to the open buffer (debounced autosave). */
  onEdit: (content: string) => void;
  /** Create a file at `path` (e.g. "folder/note.md") and open it. */
  createFile: (path: string) => Promise<void>;
  /** Rename/move the file at `from` to `to`. Resolves `false` if the rename
   * failed (so callers like the title field can roll back their UI). */
  renameEntry: (from: string, to: string) => Promise<boolean>;
  /** Delete a file (the open one, or any path). */
  deleteEntry: (path: string) => Promise<void>;
  /** Pick a different vault folder. */
  changeFolder: () => Promise<void>;
  /** Persist any pending edits to disk now (e.g. before delegating a checkbox).
   * Resolves `true` once the buffer is clean, `false` if the save didn't land. */
  flush: () => Promise<boolean>;

  // ---- Editor view (lifted so the header can own the controls) -------------
  /** Whether the open file is a markdown doc the rich editor can render. */
  isMarkdownOpen: boolean;
  /** Whether the open file is byte-canonical (rich editing leaves untouched
   * blocks byte-identical). Drives the "Format" tidy affordance. */
  canonical: boolean;
  /** Whether Rich editing is lossless (round-trip changes only formatting).
   * Drives whether Rich is offered/default — looser than `canonical`. */
  richSafe: boolean;
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
  const controller = useMemo(() => new VaultEditorController(VAULT_IO), []);
  const editor = useSyncExternalStore(controller.subscribe, controller.getState);
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const cancelTimer = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
  }, []);

  const onEdit = useCallback(
    (next: string) => {
      controller.edit(next);
      cancelTimer();
      saveTimer.current = setTimeout(() => void controller.flush(), AUTOSAVE_DEBOUNCE_MS);
    },
    [controller, cancelTimer],
  );

  const openFile = useCallback(
    (path: string) => {
      cancelTimer();
      void controller.open(path).then((opened) => {
        if (!opened) toast.error("Couldn't save the current file — resolve that before switching.");
        return undefined;
      });
    },
    [cancelTimer, controller],
  );

  const createFile = useCallback(
    async (rawPath: string) => {
      const trimmed = rawPath.trim();
      if (!trimmed) return;
      const path = /\.[a-z0-9]+$/i.test(trimmed) ? trimmed : `${trimmed}.md`;
      const bridge = getBridge();
      if (!bridge) return;
      cancelTimer();
      await controller.flush();
      if (controller.getState().dirty) {
        toast.error("Couldn't save the current file — resolve that before creating another.");
        return;
      }
      // Don't truncate an existing file — open it instead (disk truth via read).
      const exists = await bridge
        .readVaultDoc({ path })
        .then(() => true)
        .catch(() => false);
      if (exists) {
        openFile(path);
        return;
      }
      const created = await bridge
        .writeVaultDoc({ path, content: "" })
        .then(() => true)
        .catch(() => false);
      if (!created) {
        toast.error(`Couldn't create ${path}.`);
        return;
      }
      refreshList();
      openFile(path);
    },
    [cancelTimer, controller, openFile, refreshList],
  );

  const renameEntry = useCallback(
    async (from: string, to: string): Promise<boolean> => {
      const dest = to.trim();
      if (!dest || dest === from) return true; // nothing to do
      const bridge = getBridge();
      if (!bridge) return false;
      // Flush first so an in-flight write of `from` can't recreate it post-move.
      cancelTimer();
      await controller.flush();
      if (controller.getState().dirty) {
        // Save failed — don't move a file out from under unsaved edits.
        toast.error("Couldn't save the current file — resolve that before renaming.");
        return false;
      }
      const result = await bridge.renameVaultEntry({ from, to: dest }).catch(() => null);
      if (!result || !result.ok) {
        toast.error(result?.ok === false ? result.error : "Couldn't rename the file.");
        return false;
      }
      refreshList();
      // Re-open under the new path if the renamed file was the open one.
      if (controller.getState().path === from) openFile(dest);
      return true;
    },
    [cancelTimer, controller, openFile, refreshList],
  );

  const deleteEntry = useCallback(
    async (path: string) => {
      const bridge = getBridge();
      if (!bridge) return;
      if (controller.getState().path === path) {
        cancelTimer();
        await controller.remove();
      } else {
        await bridge.deleteVaultEntry({ path }).catch(() => undefined);
      }
      refreshList();
    },
    [cancelTimer, controller, refreshList],
  );

  const changeFolder = useCallback(async () => {
    cancelTimer();
    await controller.flush();
    if (controller.getState().dirty) {
      toast.error("Couldn't save the current file — resolve that before switching folders.");
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
      controller.setRoot(result.root);
      controller.clear();
      refreshList();
    }
  }, [cancelTimer, controller, refreshList]);

  const flush = useCallback(async (): Promise<boolean> => {
    cancelTimer();
    await controller.flush();
    return !controller.getState().dirty;
  }, [cancelTimer, controller]);

  // Initial load: adopt the root + list files.
  useEffect(() => {
    getBridge()
      ?.getVaultRoot()
      .then((root) => {
        controller.setRoot(root);
        return undefined;
      })
      .catch(() => {});
    refreshList();
  }, [controller, refreshList]);

  // Live updates: hand every vault-changed broadcast to the controller (reload
  // or drop the open file) and re-list the tree.
  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) return;
    return bridge.onVaultChanged(({ root }) => {
      controller.externalChange(root);
      refreshList();
    });
  }, [controller, refreshList]);

  // Persist on unmount so a change within the debounce window isn't lost.
  useEffect(() => () => void controller.flush(), [controller]);

  // Expose the flush + open-note path to non-React callers (the voice transcript
  // path) so a dictated turn persists the open note AND tags the agent with which
  // file "this note" means — same as the typed composer. The path getter reads
  // the controller live, so it stays correct without re-registering per open.
  useEffect(() => {
    registerOpenNoteFlush(flush);
    registerOpenNotePath(() => controller.getState().path);
    return () => {
      registerOpenNoteFlush(null);
      registerOpenNotePath(null);
    };
  }, [flush, controller]);

  const folderName = useMemo(() => {
    const root = editor.root.replace(/[/\\]+$/, "");
    return root.split(/[/\\]/).pop() ?? root;
  }, [editor.root]);

  // ---- Editor view (mode + canonicality) ----------------------------------
  const isMarkdownOpen = editor.path !== null && MARKDOWN_RE.test(editor.path);
  const [mode, setMode] = useState<"raw" | "rich">("raw");
  const [canonical, setCanonical] = useState(false);
  const [richSafe, setRichSafe] = useState(false);
  // The mode (raw/rich) is the user's choice and is picked once per file open.
  // `richSafe`/`canonical` still recompute on every content change (badges +
  // the `showRich` gate), but the *mode* must not be re-derived afterward — a
  // post-save flush (dirty→false, content unchanged) and an external/agent
  // reload of the same file would otherwise yank the user out of the surface
  // they picked. We track the path the mode was last chosen for to tell a real
  // file switch from those same-file re-runs.
  const modeChosenForPath = useRef<string | null>(null);
  useEffect(() => {
    if (editor.path === null || !MARKDOWN_RE.test(editor.path)) {
      setMode("raw");
      setCanonical(false);
      setRichSafe(false);
      modeChosenForPath.current = editor.path;
      return;
    }
    if (editor.dirty) return;
    const safe = isRichSafe(editor.content);
    setCanonical(isCanonical(editor.content));
    setRichSafe(safe);
    // Choose the surface only when a different file opened. (`showRich` also
    // requires `richSafe`, so a file that turns non-rich-safe out from under us
    // still falls back to raw regardless of the retained `mode`.)
    if (modeChosenForPath.current !== editor.path) {
      setMode(safe ? "rich" : "raw");
      modeChosenForPath.current = editor.path;
    }
  }, [editor.path, editor.content, editor.dirty]);

  const formatDoc = useCallback(() => {
    onEdit(toCanonical(editor.content));
    setCanonical(true);
    setRichSafe(true);
    setMode("rich");
  }, [onEdit, editor.content]);

  const value = useMemo<VaultContextValue>(
    () => ({
      editor,
      entries,
      folderName,
      openFile,
      onEdit,
      createFile,
      renameEntry,
      deleteEntry,
      changeFolder,
      flush,
      isMarkdownOpen,
      canonical,
      richSafe,
      mode,
      setMode,
      formatDoc,
    }),
    [
      editor,
      entries,
      folderName,
      openFile,
      onEdit,
      createFile,
      renameEntry,
      deleteEntry,
      changeFolder,
      flush,
      isMarkdownOpen,
      canonical,
      richSafe,
      mode,
      formatDoc,
    ],
  );

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}
