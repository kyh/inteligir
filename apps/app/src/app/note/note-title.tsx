// The page title IS the filename: an editable H1 above the document whose
// commit renames the file. Enter commits and hands focus to the editor;
// Escape restores; a blur with changes commits too. Names pass through the
// domain's ONE gate (@repo/notes checkNoteName) — reject, never sanitize.

import { checkNoteName, noteNameErrorMessage } from "@repo/notes/knowledge/note-name";
import { basenamePath, dirnamePath, joinPath } from "@repo/notes/knowledge/vault-path";
import { toast } from "@repo/ui/components/sonner";
import { useEffect, useRef, useState } from "react";

export function noteStem(path: string): string {
  const name = basenamePath(path);
  return name.endsWith(".md") ? name.slice(0, -".md".length) : name;
}

export function pathWithStem(path: string, stem: string): string {
  const name = basenamePath(path);
  const fileName = name.endsWith(".md") ? `${stem}.md` : stem;
  return joinPath(dirnamePath(path), fileName);
}

export interface NoteTitleProps {
  path: string;
  /** Rejects when the rename did not happen — the failure re-arms the commit
   * guard so the same name can be retried. */
  onRename: (toPath: string) => Promise<void>;
  onSubmit: () => void;
}

export function NoteTitle({ path, onRename, onSubmit }: NoteTitleProps) {
  const stem = noteStem(path);
  const [draft, setDraft] = useState(stem);
  const escapedRef = useRef(false);
  // Enter commits and then moves focus, which fires the blur commit too; the
  // last-sent stem swallows that echo so one rename goes out per edit. A
  // FAILED rename clears it, so the same name can be tried again.
  const lastSentRef = useRef<string | null>(null);

  useEffect(() => {
    setDraft(noteStem(path));
    lastSentRef.current = null;
  }, [path]);

  const commit = (): void => {
    if (escapedRef.current) {
      escapedRef.current = false;
      setDraft(noteStem(path));
      return;
    }
    const trimmed = draft.trim();
    if (trimmed === "" || trimmed === stem) {
      setDraft(stem);
      return;
    }
    const isMd = basenamePath(path).endsWith(".md");
    const verdict = checkNoteName(isMd ? `${trimmed}.md` : trimmed);
    if (!verdict.ok) {
      toast.error(noteNameErrorMessage(verdict.reason));
      setDraft(stem);
      return;
    }
    const next = isMd ? verdict.name.slice(0, -".md".length) : verdict.name;
    if (next !== stem && next !== lastSentRef.current) {
      lastSentRef.current = next;
      onRename(pathWithStem(path, next)).catch(() => {
        lastSentRef.current = null;
      });
    }
  };

  return (
    <input
      value={draft}
      aria-label="Note title"
      spellCheck={false}
      className="w-full bg-transparent text-3xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground/50"
      placeholder="Untitled"
      onChange={(event) => {
        lastSentRef.current = null;
        setDraft(event.target.value);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
          onSubmit();
        } else if (event.key === "Escape") {
          event.preventDefault();
          escapedRef.current = true;
          event.currentTarget.blur();
        }
      }}
    />
  );
}
