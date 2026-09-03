import { useEffect, useLayoutEffect, useRef, type KeyboardEvent } from "react";

import { toast } from "@repo/ui/components/sonner";
import { cn } from "@repo/ui/lib/utils";

import { EDITOR_COLUMN_PX } from "@repo/editor/editor-chrome";
import { MarkdownEditor } from "@repo/editor/markdown-editor";
import { useOpenNote, useOpenNotePath } from "@repo/editor/note/open-note-context";
import { registerNoteTitleFocus } from "@repo/editor/note-title-focus";
import { useVaultActions } from "@repo/editor/host";
import { checkNoteName, noteNameErrorMessage } from "@repo/notes/knowledge/note-name";
import { basenamePath, dirnamePath, joinPath } from "@repo/notes/knowledge/vault-path";

export function EditorColumn() {
  // Never select the content buffer here: typing must re-render only NoteDocument.
  const kind = useOpenNote((s) => s.openDoc.kind);
  const docPath = useOpenNotePath();
  const showRich = useOpenNote(
    (s) => s.openDoc.kind === "markdown" && s.openDoc.surface.mode === "rich",
  );

  if (kind === "none") {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
        Select a note to edit, or create one. The agent edits these same files.
      </div>
    );
  }

  if (kind === "loading" || docPath === null) return null;

  // keyed so each note gets fresh undo history and a fresh title element
  return <NoteDocument key={docPath} path={docPath} showRich={showRich} />;
}

function NoteDocument({ path, showRich }: { path: string; showRich: boolean }) {
  const content = useOpenNote((s) => s.editor.content);
  const { editNote, registerNoteSerializeFlush, renameEntry } = useVaultActions();

  const fileName = basenamePath(path);
  const dot = fileName.lastIndexOf(".");
  const displayName = dot > 0 ? fileName.slice(0, dot) : fileName;

  // React must not own the contentEditable title's children: reconciling them
  // accumulates stale text across note switches, so the text is set imperatively.
  const titleRef = useRef<HTMLHeadingElement>(null);
  const columnRef = useRef<HTMLDivElement>(null);

  // the scroller ancestor survives the keyed swap, so it must be reset by hand
  useLayoutEffect(() => {
    const scroller = columnRef.current?.closest("[data-editor-scroller]");
    if (scroller) scroller.scrollTop = 0;
  }, []);
  useEffect(() => {
    if (titleRef.current) titleRef.current.textContent = displayName;
  }, [displayName, titleRef]);

  useEffect(
    () =>
      registerNoteTitleFocus(path, () => {
        titleRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        titleRef.current?.focus();
      }),
    [path, titleRef],
  );

  const ext = dot > 0 ? fileName.slice(dot) : "";
  const dir = dirnamePath(path);

  const commitTitle = (raw: string) => {
    const next = raw.trim();
    if (next === "" || next === displayName) {
      if (titleRef.current) titleRef.current.textContent = displayName;
      return;
    }
    // Reject, never sanitize: an unchecked `/` creates folders and Windows-illegal characters break sync.
    const verdict = checkNoteName(`${next}${ext}`);
    if (!verdict.ok) {
      toast.error(noteNameErrorMessage(verdict.reason));
      if (titleRef.current) titleRef.current.textContent = displayName;
      return;
    }
    void renameEntry(path, joinPath(dir, verdict.name)).then((ok) => {
      if (!ok && titleRef.current) titleRef.current.textContent = displayName;
      return undefined;
    });
  };

  // editingRef is armed on focus and disarmed by the blur-commit BEFORE it commits
  // (a successful rename remounts, and the unmount commit must not re-run against
  // the stale path), so window blur and unmount only settle edits blur never saw.
  // A ⌘Q from the title loses the retitle: the async rename cannot finish during quit.
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
  }, [titleRef]);
  useEffect(
    () => () => {
      if (editingRef.current) {
        editingRef.current = false;
        commitTitleRef.current(titleRef.current?.textContent ?? "");
      }
    },
    [titleRef],
  );

  const onTitleKeyDown = (e: KeyboardEvent<HTMLHeadingElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.currentTarget.blur();
      columnRef.current
        ?.querySelector<HTMLElement>('[data-slate-editor="true"], textarea')
        ?.focus();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.currentTarget.textContent = displayName;
      e.currentTarget.blur();
    }
  };

  return (
    <div ref={columnRef} className="flex w-full flex-1 cursor-text flex-col pt-10 pb-72 print:pb-0">
      <h1
        ref={titleRef}
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        onFocus={() => {
          editingRef.current = true;
        }}
        onBlur={(e) => {
          editingRef.current = false;
          commitTitle(e.currentTarget.textContent ?? "");
        }}
        onKeyDown={onTitleKeyDown}
        className={cn(
          EDITOR_COLUMN_PX,
          "mb-1 w-full break-words font-[family-name:var(--editor-font)] text-[28px] font-semibold leading-[1.2] tracking-tight text-foreground outline-none empty:before:text-muted-foreground/40 empty:before:content-['Untitled']",
        )}
      />
      {showRich ? (
        <MarkdownEditor
          path={path}
          value={content}
          onChange={(md) => editNote(path, md)}
          onRegisterSerializeFlush={(flush) => registerNoteSerializeFlush(path, flush)}
        />
      ) : (
        <textarea
          value={content}
          onChange={(e) => editNote(path, e.target.value)}
          spellCheck={false}
          className={cn(
            EDITOR_COLUMN_PX,
            "min-h-[60vh] flex-1 resize-none bg-transparent pt-4 font-[family-name:var(--editor-mono)] text-[length:var(--editor-size)] leading-[var(--editor-line-height)] text-foreground outline-none",
          )}
          placeholder="Empty note"
        />
      )}
    </div>
  );
}
