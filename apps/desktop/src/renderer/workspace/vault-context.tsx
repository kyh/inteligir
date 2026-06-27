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
import {
  VaultEditorController,
  type VaultEditorState,
  type VaultIO,
} from "@/renderer/editor/vault-editor";
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
  /** Rename/move the file at `from` to `to`. */
  renameEntry: (from: string, to: string) => Promise<void>;
  /** Delete a file (the open one, or any path). */
  deleteEntry: (path: string) => Promise<void>;
  /** Pick a different vault folder. */
  changeFolder: () => Promise<void>;
  /** Persist any pending edits to disk now (e.g. before delegating a checkbox). */
  flush: () => Promise<void>;
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

  const refreshList = useCallback(() => {
    getBridge()
      ?.listVault()
      .then(setEntries)
      .catch(() => {});
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
    async (from: string, to: string) => {
      const dest = to.trim();
      if (!dest || dest === from) return;
      const bridge = getBridge();
      if (!bridge) return;
      // Flush first so an in-flight write of `from` can't recreate it post-move.
      cancelTimer();
      await controller.flush();
      const result = await bridge.renameVaultEntry({ from, to: dest }).catch(() => null);
      if (!result || !result.ok) {
        toast.error(result?.ok === false ? result.error : "Couldn't rename the file.");
        return;
      }
      refreshList();
      // Re-open under the new path if the renamed file was the open one.
      if (controller.getState().path === from) openFile(dest);
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

  const flush = useCallback(async () => {
    cancelTimer();
    await controller.flush();
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

  const folderName = useMemo(() => {
    const root = editor.root.replace(/[/\\]+$/, "");
    return root.split(/[/\\]/).pop() ?? root;
  }, [editor.root]);

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
    ],
  );

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}
