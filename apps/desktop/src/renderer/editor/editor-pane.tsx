import { useLayoutEffect } from "react";

import { cn } from "@repo/ui/lib/utils";

import { EDITOR_COLUMN_PX } from "@renderer/editor/editor-chrome";
import { MarkdownEditor } from "@renderer/editor/markdown-editor";
import { BacklinksPanel, ForwardLinksPanel } from "@renderer/workspace/links-panel";
import { useVault } from "@renderer/workspace/vault-context";

/**
 * The editor body: the open note's document (+ backlinks). One mounted
 * editor — opening another note replaces it (fresh undo history and
 * scroll, potion-style). The per-file controls (raw/rich, delete, status)
 * live in the shell header; this is just the scrolling document. Bottom
 * padding clears the pinned composer. Renaming lives in the sidebar.
 */
export function EditorPane() {
  const { editor, openPath, isMarkdownOpen, richAvailable, mode } = useVault();

  // Opening a different note starts reading from the top (the workspace
  // <main> is the scroll container and survives the swap, so it must be
  // reset explicitly).
  useLayoutEffect(() => {
    const scroller = document.querySelector("main");
    if (scroller) scroller.scrollTop = 0;
  }, [editor.path]);

  if (openPath === null) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
        Select a note to edit, or create one. The agent edits these same files.
      </div>
    );
  }

  // Still loading (or vanishing) — nothing to show yet; the runtime either
  // fills in content or closes the note.
  if (editor.path === null) return null;

  const showRich = mode === "rich" && isMarkdownOpen && richAvailable;
  // Keyed by path: a fresh pane (undo history) per note.
  return <NotePane key={editor.path} path={editor.path} showRich={showRich} />;
}

function NotePane({ path, showRich }: { path: string; showRich: boolean }) {
  const { editor, editNote, registerNoteSerializeFlush } = useVault();

  // potion-style column: the editable (PlateContent) carries the centered
  // 700px column padding itself (EDITOR_COLUMN_PX — see editor-chrome.tsx:
  // the drag gutter must live inside its clip); the Raw textarea and
  // backlinks apply the same constant so all three align byte-exact. The pane
  // owns only the vertical padding — pb-72 is the breathing room below the
  // last block (spec §4.1).
  return (
    <div className="flex w-full flex-1 cursor-text flex-col pt-10 pb-72">
      {showRich ? (
        <MarkdownEditor
          path={path}
          value={editor.content}
          onChange={(md) => editNote(path, md)}
          // Teardown settle (#374): route by the path THIS editor served —
          // the pane unmounts on note switch, when the open note may
          // already differ, so the bytes carry their own path.
          onSettled={(md) => editNote(path, md)}
          // Pre-flush hook: the runtime drains the editor's serialize
          // debounce before persisting, so save/rename/delete always see
          // the latest keystroke. Path-routed like editNote.
          onRegisterSerializeFlush={(flush) => registerNoteSerializeFlush(path, flush)}
        />
      ) : (
        <textarea
          value={editor.content}
          onChange={(e) => editNote(path, e.target.value)}
          spellCheck={false}
          className={cn(
            EDITOR_COLUMN_PX,
            "min-h-[60vh] flex-1 resize-none bg-transparent pt-4 font-mono text-sm leading-relaxed text-foreground outline-none",
          )}
          placeholder="Empty note"
        />
      )}
      {/* Linked mentions live in the same centered column, below the doc. */}
      <div className={EDITOR_COLUMN_PX}>
        <ForwardLinksPanel path={path} />
        <BacklinksPanel path={path} />
      </div>
    </div>
  );
}
