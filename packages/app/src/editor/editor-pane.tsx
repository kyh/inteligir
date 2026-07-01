import { useEffect, useRef } from "react";

import { MarkdownEditor } from "@repo/app/editor/markdown-editor";
import { useVault } from "@repo/app/workspace/vault-context";

/**
 * The editor body — Rich (Plate) for canonical markdown, Raw textarea otherwise.
 * The per-file controls (raw/rich, Format, delete, status) live in the shell
 * header; this is just the scrolling document. Bottom padding clears the pinned
 * composer.
 */
export function EditorPane() {
  const { editor, onEdit, isMarkdownOpen, richSafe, mode, renameEntry } = useVault();
  const selected = editor.path;

  const fileName = selected ? (selected.split("/").pop() ?? selected) : "";
  const dot = fileName.lastIndexOf(".");
  const displayName = dot > 0 ? fileName.slice(0, dot) : fileName;

  // The title is a contentEditable, so React must NOT own its text children
  // (reconciling a contentEditable's children accumulates stale text across
  // note switches). We set the text imperatively when the open file changes;
  // the browser owns it while editing.
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (titleRef.current) titleRef.current.textContent = displayName;
  }, [displayName]);

  if (selected === null) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
        Select a note to edit, or create one. The agent edits these same files.
      </div>
    );
  }

  const showRich = mode === "rich" && isMarkdownOpen && richSafe;
  const ext = dot > 0 ? fileName.slice(dot) : "";
  const slash = selected.lastIndexOf("/");
  const dir = slash === -1 ? "" : selected.slice(0, slash + 1);

  // Editing the title renames the underlying file (the filename IS the title).
  const commitTitle = (raw: string) => {
    const next = raw.trim();
    if (next === "" || next === displayName) {
      if (titleRef.current) titleRef.current.textContent = displayName;
      return;
    }
    void renameEntry(selected, `${dir}${next}${ext}`).then((ok) => {
      // On success the path changes and the effect resets the title to the new
      // name; on failure roll the contentEditable back to the real filename so
      // the header never shows a name that was never saved.
      if (!ok && titleRef.current) titleRef.current.textContent = displayName;
      return undefined;
    });
  };

  // potion-style column: a centered 700px text column (symmetric padding, not
  // max-w), the filename rendered as a large editable page title (chrome only —
  // never serialized), then the body. Same column wraps the Raw textarea.
  return (
    <div className="flex w-full flex-1 cursor-text flex-col px-12 pt-10 pb-72 sm:px-[max(48px,calc(50%-350px))]">
      <h1
        ref={titleRef}
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        onBlur={(e) => commitTitle(e.currentTarget.textContent ?? "")}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            e.currentTarget.textContent = displayName;
            e.currentTarget.blur();
          }
        }}
        className="mb-1 w-full break-words text-4xl font-bold leading-[1.2] text-foreground outline-none empty:before:text-muted-foreground/40 empty:before:content-['Untitled']"
      />
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
