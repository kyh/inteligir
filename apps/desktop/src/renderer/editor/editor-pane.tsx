import { useState } from "react";
import { Trash2Icon } from "lucide-react";

import { Button } from "@repo/ui/components/button";
import { cn } from "@repo/ui/lib/utils";

import { MarkdownEditor } from "@/renderer/editor/markdown-editor";
import { useVault } from "@/renderer/workspace/vault-context";

// Files eligible for the rich (Plate) editor. `.mdx` is excluded — the Plate
// markdown pipeline doesn't parse/serialize MDX (JSX/expressions), so it stays
// raw-only.
const MARKDOWN_RE = /\.(md|markdown)$/i;

/**
 * The editor pane — header (filename, Raw/Rich toggle, save status, delete) over
 * the open document. Raw is a plain textarea (byte-stable); Rich is the Plate
 * editor (M2 makes it byte-stable + the default).
 */
export function EditorPane() {
  const { editor, onEdit, deleteEntry } = useVault();
  const [mode, setMode] = useState<"raw" | "rich">("raw");

  const selected = editor.path;

  if (selected === null) {
    return (
      <div className="flex h-full flex-1 items-center justify-center p-4 text-center text-[11px] text-muted-foreground">
        Select a file to edit, or create one. The agent edits these same files.
      </div>
    );
  }

  const isMarkdown = MARKDOWN_RE.test(selected);

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
        <span className="truncate text-[12px] text-foreground">{selected}</span>
        <span className="flex items-center gap-2">
          {isMarkdown && (
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
            onClick={() => {
              if (window.confirm(`Delete ${selected}?`)) void deleteEntry(selected);
            }}
            className="h-auto px-1.5 py-0.5 text-muted-foreground hover:text-destructive"
            title="Delete file"
          >
            <Trash2Icon className="size-3.5" />
          </Button>
        </span>
      </div>

      {mode === "rich" && isMarkdown ? (
        <div className="mx-auto min-h-0 w-full max-w-3xl flex-1 overflow-auto">
          <MarkdownEditor
            key={selected}
            value={editor.content}
            onChange={(md) => {
              // Plate normalizes on mount; only mark dirty on a real change so
              // opening a file in rich mode doesn't trigger a rewrite.
              if (md !== editor.content) onEdit(md);
            }}
          />
        </div>
      ) : (
        <textarea
          value={editor.content}
          onChange={(e) => onEdit(e.target.value)}
          spellCheck={false}
          className="mx-auto min-h-0 w-full max-w-3xl flex-1 resize-none bg-transparent px-4 py-3 font-mono text-[12px] leading-relaxed text-foreground outline-none"
          placeholder="Empty file"
        />
      )}
    </div>
  );
}
