import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { BracesIcon, FilePlusIcon, FileTextIcon, FolderIcon, Trash2Icon } from "lucide-react";
import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { toast } from "@repo/ui/components/sonner";
import { cn } from "@repo/ui/lib/utils";

import { getBridge } from "@/renderer/lib/bridge";
import { MarkdownEditor } from "@/renderer/shell/builtin/markdown-editor";
import { VaultEditorController, type VaultIO } from "@/renderer/shell/builtin/vault-editor";
import type { VaultEntry } from "@/shared/ipc-registry";

// Files eligible for the rich (Plate) editor. `.mdx` is intentionally excluded:
// the Plate markdown pipeline doesn't parse/serialize MDX (JSX/expressions), so
// rich-editing one would risk a destructive rewrite — it stays raw-only.
const MARKDOWN_RE = /\.(md|markdown)$/i;
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

/**
 * The Vault panel — a minimal Obsidian-style browser/editor over the user's
 * knowledge folder. The folder is the app's data store; the agent and widgets
 * read/write the same files. This panel is the human surface: pick the folder,
 * browse files, edit them as raw text (JSON included), and watch them update
 * live when the agent or a widget changes something.
 *
 * The open-file editing session (open/edit/save/reload/delete and all their
 * async ordering) lives in VaultEditorController; this component owns only the
 * pure UI (file list, filter, raw/rich mode) and the autosave debounce.
 */
export function VaultPanel() {
  const controller = useMemo(() => new VaultEditorController(VAULT_IO), []);
  const editor = useSyncExternalStore(controller.subscribe, controller.getState);

  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [filter, setFilter] = useState("");
  const [newName, setNewName] = useState("");
  // Rich (Plate) vs raw textarea. Defaults to raw — the rich editor round-trips
  // markdown (normalizing it), so it's always an explicit opt-in.
  const [mode, setMode] = useState<"raw" | "rich">("raw");

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

  const scheduleFlush = useCallback(() => {
    cancelTimer();
    saveTimer.current = setTimeout(() => void controller.flush(), AUTOSAVE_DEBOUNCE_MS);
  }, [cancelTimer, controller]);

  const onEdit = useCallback(
    (next: string) => {
      controller.edit(next);
      scheduleFlush();
    },
    [controller, scheduleFlush],
  );

  const openFile = useCallback(
    (path: string) => {
      cancelTimer();
      void controller.open(path);
    },
    [cancelTimer, controller],
  );

  // Initial load: adopt the root and list files.
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

  // Live updates: hand every vault-changed broadcast to the controller (which
  // reloads or drops the open file as appropriate) and re-list.
  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) return;
    return bridge.onVaultChanged(({ root }) => {
      controller.externalChange(root);
      refreshList();
    });
  }, [controller, refreshList]);

  // Persist on unmount so a change within the debounce window isn't lost.
  useEffect(() => {
    return () => void controller.flush();
  }, [controller]);

  const handleChangeFolder = useCallback(async () => {
    cancelTimer();
    await controller.flush();
    // If the save failed, the buffer is still dirty — don't switch folders and
    // silently drop the unsaved text; surface it and let the user retry.
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

  const handleCreate = useCallback(async () => {
    const raw = newName.trim();
    if (!raw) return;
    const name = /\.[a-z0-9]+$/i.test(raw) ? raw : `${raw}.md`;
    const bridge = getBridge();
    if (!bridge) return;
    cancelTimer();
    await controller.flush();
    // Don't truncate an existing file — a write with empty content would wipe
    // notes/JSON already there. A successful read means it exists, so open it
    // instead. (Disk-truth via the read IPC, not the possibly-stale listing.)
    const exists = await bridge
      .readVaultDoc({ path: name })
      .then(() => true)
      .catch(() => false);
    if (exists) {
      toast.error(`${name} already exists.`);
      setNewName("");
      openFile(name);
      return;
    }
    const created = await bridge
      .writeVaultDoc({ path: name, content: "" })
      .then(() => true)
      .catch(() => false);
    if (!created) {
      toast.error(`Couldn't create ${name}.`);
      return;
    }
    setNewName("");
    refreshList();
    openFile(name);
  }, [newName, cancelTimer, controller, refreshList, openFile]);

  const handleDelete = useCallback(() => {
    cancelTimer();
    void controller.remove().then(refreshList);
  }, [cancelTimer, controller, refreshList]);

  const selected = editor.path;
  const folderName =
    editor.root
      .replace(/[/\\]+$/, "")
      .split(/[/\\]/)
      .pop() ?? editor.root;
  const visible = filter
    ? entries.filter((e) => e.path.toLowerCase().includes(filter.toLowerCase()))
    : entries;

  return (
    <div className="flex h-full flex-col text-xs">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <button
          type="button"
          onClick={() => void handleChangeFolder()}
          title={editor.root}
          className="flex min-w-0 items-center gap-1.5 text-muted-foreground hover:text-foreground"
        >
          <FolderIcon className="size-3.5 shrink-0" />
          <span className="truncate">{folderName || "Choose folder…"}</span>
        </button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void handleChangeFolder()}
          className="h-auto shrink-0 px-2 py-0.5 text-[10px] text-muted-foreground"
        >
          Change
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex w-44 shrink-0 flex-col border-r border-border">
          <div className="flex flex-col gap-1.5 border-b border-border p-2">
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter files"
              className="h-6 text-[11px]"
            />
            <div className="flex items-center gap-1">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleCreate();
                }}
                placeholder="new-note.md"
                className="h-6 text-[11px]"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleCreate()}
                disabled={newName.trim().length === 0}
                className="h-6 shrink-0 px-1.5"
                title="Create file"
              >
                <FilePlusIcon className="size-3.5" />
              </Button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-1">
            {visible.length === 0 ? (
              <p className="p-2 text-[10px] text-muted-foreground">No files yet.</p>
            ) : (
              visible.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  onClick={() => openFile(entry.path)}
                  className={cn(
                    "flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[11px]",
                    selected === entry.path
                      ? "bg-foreground/15 text-foreground"
                      : "text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
                  )}
                >
                  {entry.kind === "blob" ? (
                    <BracesIcon className="size-3 shrink-0" />
                  ) : (
                    <FileTextIcon className="size-3 shrink-0" />
                  )}
                  <span className="truncate">{entry.path}</span>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          {selected === null ? (
            <div className="flex flex-1 items-center justify-center p-4 text-center text-[11px] text-muted-foreground">
              Select a file to edit, or create one. The agent and widgets share these files.
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
                <span className="truncate text-[11px] text-foreground">{selected}</span>
                <span className="flex items-center gap-2">
                  {MARKDOWN_RE.test(selected) && (
                    <div className="flex items-center rounded border border-border text-[10px]">
                      {(["raw", "rich"] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setMode(m)}
                          aria-pressed={mode === m}
                          className={cn(
                            "px-1.5 py-0.5 capitalize",
                            mode === m
                              ? "bg-foreground/15 text-foreground"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  )}
                  <span className="text-[10px] text-muted-foreground">
                    {editor.dirty || editor.saving ? "Saving…" : "Saved"}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleDelete}
                    className="h-auto px-1.5 py-0.5 text-muted-foreground hover:text-destructive"
                    title="Delete file"
                  >
                    <Trash2Icon className="size-3.5" />
                  </Button>
                </span>
              </div>
              {mode === "rich" && MARKDOWN_RE.test(selected) ? (
                <div className="min-h-0 flex-1 overflow-auto">
                  <MarkdownEditor
                    key={selected}
                    value={editor.content}
                    onChange={(md) => {
                      // Plate normalizes on mount; only mark dirty on a real change
                      // so opening a file in rich mode doesn't trigger a rewrite.
                      if (md !== controller.getState().content) onEdit(md);
                    }}
                  />
                </div>
              ) : (
                <textarea
                  value={editor.content}
                  onChange={(e) => onEdit(e.target.value)}
                  spellCheck={false}
                  className="min-h-0 flex-1 resize-none bg-transparent p-3 font-mono text-[11px] leading-relaxed text-foreground outline-none"
                  placeholder="Empty file"
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
