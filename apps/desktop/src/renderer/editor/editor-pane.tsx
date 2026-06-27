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
  const fileName = selected.split("/").pop() ?? selected;
  const displayName = fileName.replace(/\.md$/i, "");

  // potion-style column: a centered 700px text column (symmetric padding, not
  // max-w), the filename rendered as a large page title (chrome only — never
  // serialized), then the body. Same column wraps the Raw textarea fallback.
  return (
    <div className="flex w-full flex-1 cursor-text flex-col px-12 pt-10 pb-72 sm:px-[max(48px,calc(50%-350px))]">
      <h1 className="mb-1 w-full break-words text-4xl font-bold leading-[1.2] text-foreground">
        {displayName}
      </h1>
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
          className="min-h-[60vh] flex-1 resize-none bg-transparent pt-4 font-mono text-sm leading-relaxed text-foreground outline-none"
          placeholder="Empty note"
        />
      )}
    </div>
  );
}
