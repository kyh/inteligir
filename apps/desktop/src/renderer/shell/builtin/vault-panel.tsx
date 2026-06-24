import { useCallback, useEffect, useRef, useState } from "react";
import { BracesIcon, FilePlusIcon, FileTextIcon, FolderIcon, Trash2Icon } from "lucide-react";
import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { toast } from "@repo/ui/components/sonner";
import { cn } from "@repo/ui/lib/utils";

import { getBridge } from "@/renderer/lib/bridge";
import { MarkdownEditor } from "@/renderer/shell/builtin/markdown-editor";
import type { VaultEntry } from "@/shared/ipc-registry";

const MARKDOWN_RE = /\.(md|markdown|mdx)$/i;

const AUTOSAVE_DEBOUNCE_MS = 600;

/**
 * The Vault panel — a minimal Obsidian-style browser/editor over the user's
 * knowledge folder. The folder is the app's data store; the agent and widgets
 * read/write the same files. This panel is the human surface: pick the folder,
 * browse files, edit them as raw text (JSON included), and watch them update
 * live when the agent or a widget changes something.
 */
export function VaultPanel() {
  const [root, setRoot] = useState<string>("");
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [newName, setNewName] = useState("");
  // Rich (Plate) vs raw textarea. Defaults to raw — the rich editor round-trips
  // markdown (normalizing it), so it's always an explicit opt-in.
  const [mode, setMode] = useState<"raw" | "rich">("raw");

  // Save coordination: the path/content we last persisted, plus the debounce
  // timer, so switching files or an external change never clobbers live edits.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The in-flight save promise (null when idle). Saves are serialized through
  // it, and the live-reload below refuses to run while it's set so a disk read
  // can't revert the editor under an unfinished write.
  const savingRef = useRef<Promise<void> | null>(null);
  const selectedRef = useRef<string | null>(null);
  const contentRef = useRef("");
  const dirtyRef = useRef(false);
  selectedRef.current = selected;
  contentRef.current = content;
  dirtyRef.current = dirty;
  // Latest-wins for openFile: a slower read must not apply to a file the user
  // has since switched away from.
  const openSeq = useRef(0);

  const refreshList = useCallback(() => {
    const bridge = getBridge();
    if (!bridge) return;
    void bridge
      .listVault()
      .then(setEntries)
      .catch(() => {});
  }, []);

  const flushSave = useCallback(async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    // Serialize behind any in-flight write so two saves can't overlap and a
    // trailing edit can't be written before an earlier one lands.
    if (savingRef.current) await savingRef.current.catch(() => {});
    const path = selectedRef.current;
    if (!path || !dirtyRef.current) return;
    const bridge = getBridge();
    if (!bridge) return;
    // Snapshot the bytes we're persisting. `dirty` is cleared only after the
    // write succeeds AND the editor still holds exactly this snapshot — if the
    // user typed during the write, dirty stays set so the newer text saves next.
    const snapshot = contentRef.current;
    const writing = bridge
      .writeVaultDoc({ path, content: snapshot })
      .then(() => {
        if (contentRef.current === snapshot) {
          dirtyRef.current = false;
          setDirty(false);
        }
        return undefined;
      })
      .catch(() => {
        // Leave dirty set so a later flush retries.
      });
    savingRef.current = writing;
    await writing;
    if (savingRef.current === writing) savingRef.current = null;
  }, []);

  // Apply a freshly opened file's text, syncing refs immediately (they're
  // otherwise only updated on render, which flushSave / the reload path read).
  const applyOpened = useCallback((path: string, text: string) => {
    setSelected(path);
    setContent(text);
    setDirty(false);
    selectedRef.current = path;
    contentRef.current = text;
    dirtyRef.current = false;
  }, []);

  const openFile = useCallback(
    async (path: string) => {
      await flushSave();
      const bridge = getBridge();
      if (!bridge) return;
      const seq = ++openSeq.current;
      try {
        const text = await bridge.readVaultDoc({ path });
        if (openSeq.current !== seq) return; // a later openFile superseded this one
        applyOpened(path, text);
      } catch {
        if (openSeq.current !== seq) return;
        applyOpened(path, "");
      }
    },
    [flushSave, applyOpened],
  );

  // Initial load: root + list.
  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) return;
    void bridge
      .getVaultRoot()
      .then(setRoot)
      .catch(() => {});
    refreshList();
  }, [refreshList]);

  // Live updates: re-list on any vault change; reload the open file if it
  // changed underneath us and we have no unsaved edits.
  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) return;
    return bridge.onVaultChanged(({ root: nextRoot }) => {
      setRoot(nextRoot);
      refreshList();
      const path = selectedRef.current;
      // Never reload while we have unsaved edits or a save is in flight — that's
      // how a disk read could revert the editor or clobber newer text.
      if (path && !dirtyRef.current && savingRef.current === null) {
        bridge
          .readVaultDoc({ path })
          .then((text) => {
            if (selectedRef.current === path && !dirtyRef.current && savingRef.current === null) {
              contentRef.current = text;
              setContent(text);
            }
            return undefined;
          })
          .catch(() => {
            // Read failed — the file was likely deleted elsewhere. Clear the now
            // stale editor (it's already gone from the re-listed sidebar).
            if (selectedRef.current === path && !dirtyRef.current) {
              setSelected(null);
              setContent("");
            }
          });
      }
    });
  }, [refreshList]);

  // Persist on unmount so a panel close within the debounce window isn't lost.
  useEffect(() => {
    return () => void flushSave();
  }, [flushSave]);

  const handleChangeFolder = useCallback(async () => {
    await flushSave();
    const bridge = getBridge();
    if (!bridge) return;
    const result = await bridge.chooseVaultRoot().catch(() => null);
    if (!result) return;
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    if ("root" in result) {
      setRoot(result.root);
      setSelected(null);
      setContent("");
      setDirty(false);
      refreshList();
    }
  }, [flushSave, refreshList]);

  const handleEdit = useCallback(
    (next: string) => {
      // Sync the refs now, not on the next render — flushSave and the vault
      // reload path read these synchronously, so a broadcast landing before
      // paint must already see the edit as dirty with the new text.
      contentRef.current = next;
      dirtyRef.current = true;
      setContent(next);
      setDirty(true);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void flushSave(), AUTOSAVE_DEBOUNCE_MS);
    },
    [flushSave],
  );

  const handleCreate = useCallback(async () => {
    const raw = newName.trim();
    if (!raw) return;
    const name = /\.[a-z0-9]+$/i.test(raw) ? raw : `${raw}.md`;
    const bridge = getBridge();
    if (!bridge) return;
    await flushSave();
    await bridge.writeVaultDoc({ path: name, content: "" }).catch(() => {});
    setNewName("");
    refreshList();
    void openFile(name);
  }, [newName, flushSave, refreshList, openFile]);

  const handleDelete = useCallback(async () => {
    const path = selectedRef.current;
    if (!path) return;
    const bridge = getBridge();
    if (!bridge) return;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    // Drop the dirty flag (so no new save starts) and let any in-flight write
    // finish before deleting, or it could recreate the file we just removed.
    dirtyRef.current = false;
    setDirty(false);
    if (savingRef.current) await savingRef.current.catch(() => {});
    await bridge.deleteVaultEntry({ path }).catch(() => {});
    setSelected(null);
    setContent("");
    setDirty(false);
    refreshList();
  }, [refreshList]);

  const folderName =
    root
      .replace(/[/\\]+$/, "")
      .split(/[/\\]/)
      .pop() ?? root;
  const visible = filter
    ? entries.filter((e) => e.path.toLowerCase().includes(filter.toLowerCase()))
    : entries;

  return (
    <div className="flex h-full flex-col text-xs">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <button
          type="button"
          onClick={() => void handleChangeFolder()}
          title={root}
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
                  onClick={() => void openFile(entry.path)}
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
                    {dirty ? "Saving…" : "Saved"}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleDelete()}
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
                    value={content}
                    onChange={(md) => {
                      // Plate normalizes on mount; only mark dirty on a real change
                      // so opening a file in rich mode doesn't trigger a rewrite.
                      if (md !== contentRef.current) handleEdit(md);
                    }}
                  />
                </div>
              ) : (
                <textarea
                  value={content}
                  onChange={(e) => handleEdit(e.target.value)}
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
