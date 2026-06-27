import { MarkdownEditor } from "@/renderer/editor/markdown-editor";
import { useVault } from "@/renderer/workspace/vault-context";

/**
 * The editor body — Rich (Plate) for canonical markdown, Raw textarea otherwise.
 * The per-file controls (raw/rich, Format, delete, status) live in the shell
 * header; this is just the scrolling document. Bottom padding clears the pinned
 * composer.
 */
export function EditorPane() {
  const { editor, onEdit, isMarkdownOpen, canonical, mode } = useVault();
  const selected = editor.path;

  if (selected === null) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
        Select a note to edit, or create one. The agent edits these same files.
      </div>
    );
  }

  const showRich = mode === "rich" && isMarkdownOpen && canonical;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-2 pb-40">
      {showRich ? (
        <MarkdownEditor
          key={selected}
          value={editor.content}
          onChange={(md) => {
            if (md !== editor.content) onEdit(md);
          }}
        />
      ) : (
        <textarea
          value={editor.content}
          onChange={(e) => onEdit(e.target.value)}
          spellCheck={false}
          className="min-h-[60vh] flex-1 resize-none bg-transparent px-2 py-4 font-mono text-sm leading-relaxed text-foreground outline-none"
          placeholder="Empty note"
        />
      )}
    </div>
  );
}
