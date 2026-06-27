import { useEffect, useMemo, useRef, useState } from "react";
import { Trash2Icon, WandSparklesIcon } from "lucide-react";

import { Button } from "@repo/ui/components/button";
import { cn } from "@repo/ui/lib/utils";

import { MarkdownEditor } from "@/renderer/editor/markdown-editor";
import { isCanonical, toCanonical } from "@/renderer/editor/markdown-doc";
import { LinksPanel } from "@/renderer/editor/links-panel";
import { useVault } from "@/renderer/workspace/vault-context";

// Files eligible for the rich (Plate) editor. `.mdx` is excluded — the Plate
// markdown pipeline doesn't parse/serialize MDX (JSX/expressions), so it stays
// raw-only.
const MARKDOWN_RE = /\.(md|markdown)$/i;

/**
 * The editor pane. Rich (Plate) is the default for canonical markdown — files
 * where re-serializing reshapes nothing, so a Plate edit yields a minimal,
 * byte-stable diff. Non-canonical files open Raw (byte-exact) with a one-click
 * Format that canonicalizes them; idempotency keeps them stable afterward.
 */
export function EditorPane() {
  const { editor, onEdit, deleteEntry } = useVault();
  const [mode, setMode] = useState<"raw" | "rich">("raw");

  const selected = editor.path;
  const isMarkdown = selected !== null && MARKDOWN_RE.test(selected);

  // Re-derived per content change but cheap; gates the Rich toggle + Format.
  const canonical = useMemo(
    () => (isMarkdown ? isCanonical(editor.content) : false),
    [isMarkdown, editor.content],
  );

  // Read the latest content without re-seeding the default mode on every
  // keystroke — the default is chosen when the *file* changes, from its loaded
  // (canonical-or-not) content.
  const contentRef = useRef(editor.content);
  contentRef.current = editor.content;
  useEffect(() => {
    if (selected === null || !isMarkdown) {
      setMode("raw");
      return;
    }
    setMode(isCanonical(contentRef.current) ? "rich" : "raw");
  }, [selected, isMarkdown]);

  if (selected === null) {
    return (
      <div className="flex h-full flex-1 items-center justify-center p-4 text-center text-[11px] text-muted-foreground">
        Select a file to edit, or create one. The agent edits these same files.
      </div>
    );
  }

  const handleFormat = () => {
    onEdit(toCanonical(editor.content));
    setMode("rich");
  };

  const showRich = mode === "rich" && isMarkdown && canonical;

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
        <span className="truncate text-[12px] text-foreground">{selected}</span>
        <span className="flex items-center gap-2">
          {isMarkdown && !canonical && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleFormat}
              title="Reformat to canonical markdown so rich editing stays byte-stable"
              className="h-6 gap-1 px-1.5 text-[10px]"
            >
              <WandSparklesIcon className="size-3" />
              Format
            </Button>
          )}
          {isMarkdown && canonical && (
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

      {showRich ? (
        <div className="mx-auto min-h-0 w-full max-w-3xl flex-1 overflow-auto">
          <MarkdownEditor
            key={selected}
            value={editor.content}
            onChange={(md) => {
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

      {isMarkdown && <LinksPanel />}
    </div>
  );
}
