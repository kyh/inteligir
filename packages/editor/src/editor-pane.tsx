import { useEffect, useLayoutEffect, useRef, type KeyboardEvent } from "react";

import { toast } from "@repo/ui/components/sonner";
import { cn } from "@repo/ui/lib/utils";

import { EDITOR_COLUMN_PX } from "@repo/editor/editor-chrome";
import { MarkdownEditor } from "@repo/editor/markdown-editor";
import { openDocPath } from "@repo/editor/note/open-doc";
import { useOpenNote } from "@repo/editor/note/open-note-store";
import { useConnectionsPanel, useVaultActions } from "@repo/editor/host";
import { checkNoteName, noteNameErrorMessage } from "@repo/notes/knowledge/note-name";
import { basenamePath } from "@repo/notes/knowledge/vault-path";

/**
 * The editor body: the open note's page title + document (+ connections). One
 * mounted editor — opening another note replaces it (fresh undo history and
 * scroll, potion-style). The per-file controls (raw/rich, delete, status)
 * live in the shell header; this is just the scrolling document. Bottom
 * padding clears the pinned composer.
 */
export function EditorPane() {
  // Narrow selectors: the pane's mount decision depends on the doc's
  // kind/path/surface — never on the content buffer, so typing re-renders
  // only the NotePane below.
  const kind = useOpenNote((s) => s.openDoc.kind);
  const docPath = useOpenNote((s) => openDocPath(s.openDoc));
  const loadedPath = useOpenNote((s) => s.editor.path);
  const showRich = useOpenNote(
    (s) => s.openDoc.kind === "markdown" && s.openDoc.surface.mode === "rich",
  );

  // Opening a different note starts reading from the top (the workspace
  // <main> is the scroll container and survives the swap, so it must be
  // reset explicitly).
  useLayoutEffect(() => {
    const scroller = document.querySelector("main");
    if (scroller) scroller.scrollTop = 0;
  }, [loadedPath]);

  if (kind === "none") {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
        Select a note to edit, or create one. The agent edits these same files.
      </div>
    );
  }

  // Still loading (or vanishing) — nothing to show yet; the runtime either
  // fills in content or closes the note. (docPath is null only for "none",
  // handled above — the guard keeps the narrowing explicit.)
  if (kind === "loading" || docPath === null) return null;

  // Keyed by path: a fresh pane (undo history, title contentEditable) per note.
  return <NotePane key={docPath} path={docPath} showRich={showRich} />;
}

function NotePane({ path, showRich }: { path: string; showRich: boolean }) {
  // The ONE content subscriber: the editor legitimately re-renders per
  // keystroke (Raw) / serialize settle (Rich).
  const content = useOpenNote((s) => s.editor.content);
  const { editNote, registerNoteSerializeFlush, renameEntry } = useVaultActions();
  const ConnectionsPanel = useConnectionsPanel();

  const fileName = basenamePath(path);
  const dot = fileName.lastIndexOf(".");
  const displayName = dot > 0 ? fileName.slice(0, dot) : fileName;

  // The title is a contentEditable, so React must NOT own its text children
  // (reconciling a contentEditable's children accumulates stale text across
  // note switches). We set the text imperatively when the file (re)names;
  // the browser owns it while editing.
  const titleRef = useRef<HTMLHeadingElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (titleRef.current) titleRef.current.textContent = displayName;
  }, [displayName]);

  const ext = dot > 0 ? fileName.slice(dot) : "";
  const slash = path.lastIndexOf("/");
  const dir = slash === -1 ? "" : path.slice(0, slash + 1);

  // Editing the title renames the underlying file (the filename IS the title).
  const commitTitle = (raw: string) => {
    const next = raw.trim();
    if (next === "" || next === displayName) {
      if (titleRef.current) titleRef.current.textContent = displayName;
      return;
    }
    // Validate the would-be basename (title + extension) before any rename: a
    // an unchecked `/` silently creates folders, and `: * ? " < > |` mint
    // names that break on Windows/sync. Reject + rollback + toast — never
    // sanitize.
    const verdict = checkNoteName(`${next}${ext}`);
    if (!verdict.ok) {
      toast.error(noteNameErrorMessage(verdict.reason));
      if (titleRef.current) titleRef.current.textContent = displayName;
      return;
    }
    void renameEntry(path, `${dir}${verdict.name}`).then((ok) => {
      // On success the path changes and the renamed note mounts a fresh pane;
      // on failure roll the contentEditable back to the real filename so the
      // title never shows a name that was never saved.
      if (!ok && titleRef.current) titleRef.current.textContent = displayName;
      return undefined;
    });
  };

  // Title settle rails beyond blur/Enter: `editingRef` is armed on focus and
  // disarmed by the element's own blur-commit, so these only fire for edits
  // the normal path never saw. (1) Window blur — ⌘Tab away mid-edit routes
  // through the element blur, i.e. the normal commit. (2) Pane unmount — an
  // external note switch/teardown while the title is still focused commits
  // the pending text directly. A ⌘Q straight from the title remains the
  // documented edge: the async rename can't finish during quit (content is
  // safe via the runtime flush; only the retitle is lost).
  const editingRef = useRef(false);
  const commitTitleRef = useRef(commitTitle);
  useEffect(() => {
    commitTitleRef.current = commitTitle;
  });
  useEffect(() => {
    const onWindowBlur = () => {
      if (editingRef.current) titleRef.current?.blur();
    };
    window.addEventListener("blur", onWindowBlur);
    return () => window.removeEventListener("blur", onWindowBlur);
  }, []);
  useEffect(
    () => () => {
      if (editingRef.current) {
        editingRef.current = false;
        commitTitleRef.current(titleRef.current?.textContent ?? "");
      }
    },
    [],
  );

  // Enter in the title drops the caret into the body (potion behavior): the
  // editor's editable in Rich mode, the textarea in Raw. The body mounts as a
  // sibling inside paneRef, so the query never escapes this pane.
  const onTitleKeyDown = (e: KeyboardEvent<HTMLHeadingElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.currentTarget.blur();
      paneRef.current?.querySelector<HTMLElement>('[data-slate-editor="true"], textarea')?.focus();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.currentTarget.textContent = displayName;
      e.currentTarget.blur();
    }
  };

  // potion-style column: the editable (PlateContent) carries the centered
  // 700px column padding itself (EDITOR_COLUMN_PX — see editor-chrome.tsx:
  // the drag gutter must live inside its clip); the title, Raw textarea, and
  // backlinks apply the same constant so all four align byte-exact. The pane
  // owns only the vertical padding — pb-72 is the breathing room below the
  // last block (spec §4.1).
  return (
    <div ref={paneRef} className="flex w-full flex-1 cursor-text flex-col pt-10 pb-72">
      <h1
        ref={titleRef}
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        onFocus={() => {
          editingRef.current = true;
        }}
        onBlur={(e) => {
          // Disarm BEFORE committing: a successful rename remounts the pane,
          // and the unmount flush must not re-commit the same edit against
          // the now-stale old path.
          editingRef.current = false;
          commitTitle(e.currentTarget.textContent ?? "");
        }}
        onKeyDown={onTitleKeyDown}
        className={cn(
          EDITOR_COLUMN_PX,
          "mb-1 w-full break-words font-[family-name:var(--editor-font-family)] text-[28px] font-semibold leading-[1.2] tracking-tight text-foreground outline-none empty:before:text-muted-foreground/40 empty:before:content-['Untitled']",
        )}
      />
      {showRich ? (
        <MarkdownEditor
          path={path}
          value={content}
          onChange={(md) => editNote(path, md)}
          // Teardown settle: route by the path THIS editor served —
          // the pane unmounts on note switch, when the open note may
          // already differ, so the bytes carry their own path.
          // Pre-flush hook: the runtime drains the editor's serialize
          // debounce before persisting, so save/rename/delete always see
          // the latest keystroke. Path-routed like editNote.
          onRegisterSerializeFlush={(flush) => registerNoteSerializeFlush(path, flush)}
        />
      ) : (
        <textarea
          value={content}
          onChange={(e) => editNote(path, e.target.value)}
          spellCheck={false}
          className={cn(
            EDITOR_COLUMN_PX,
            "min-h-[60vh] flex-1 resize-none bg-transparent pt-4 font-[family-name:var(--editor-mono-family)] text-[length:var(--editor-font-size)] leading-[var(--editor-line-height)] text-foreground outline-none",
          )}
          placeholder="Empty note"
        />
      )}
      {/* Linked mentions live in the same centered column, below the doc. */}
      <div className={EDITOR_COLUMN_PX}>
        <ConnectionsPanel path={path} />
      </div>
    </div>
  );
}
