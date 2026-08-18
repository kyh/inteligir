// The page title IS the filename: an editable H1 above the document whose
// commit renames the file. Enter commits and hands focus to the editor;
// Escape restores; a blur with changes commits too. Names pass through the
// domain's ONE gate (@repo/notes checkNoteName) — reject, never sanitize.
//
// It is set QUIETER than the note's own `# H1`, which sits ~60px below it: two
// bold lines that size alike read as one heading stuttered twice, and the one
// that should win is the document's, not the file's.
//
// Which extension the title hides is the domain's answer too (`docExtension`),
// never `.md` spelled here: the server indexes and lists `.markdown`, `.mdx`
// and `.txt` as docs, and a title that only knows one of them shows the other
// three their extension inside the editable name.

import { docExtension, docStem } from "@repo/notes/knowledge/doc-file";
import { checkNoteName, noteNameErrorMessage } from "@repo/notes/knowledge/note-name";
import { dirnamePath, joinPath } from "@repo/notes/knowledge/vault-path";
import { toast } from "@repo/ui/components/sonner";
import { useEffect, useRef, useState } from "react";

export interface NoteTitleProps {
  path: string;
  /** Rejects when the rename did not happen — the failure re-arms the commit
   * guard so the same name can be retried. */
  onRename: (toPath: string) => Promise<void>;
  onSubmit: () => void;
}

export function NoteTitle({ path, onRename, onSubmit }: NoteTitleProps) {
  const stem = docStem(path);
  const [draft, setDraft] = useState(stem);
  const escapedRef = useRef(false);
  // Enter commits and then moves focus, which fires the blur commit too; the
  // last-sent path swallows that echo so one rename goes out per edit. A
  // FAILED rename clears it, so the same name can be tried again.
  const lastSentRef = useRef<string | null>(null);

  useEffect(() => {
    setDraft(docStem(path));
    lastSentRef.current = null;
  }, [path]);

  const commit = (): void => {
    if (escapedRef.current) {
      escapedRef.current = false;
      setDraft(docStem(path));
      return;
    }
    const trimmed = draft.trim();
    if (trimmed === "" || trimmed === stem) {
      setDraft(stem);
      return;
    }
    // The gate takes the whole BASENAME, and it has to run before the join:
    // `joinPath` would resolve a `/` the user typed into a folder, which is
    // precisely the separator `checkNoteName` exists to refuse.
    const verdict = checkNoteName(`${trimmed}${docExtension(path)}`);
    if (!verdict.ok) {
      toast.error(noteNameErrorMessage(verdict.reason));
      setDraft(stem);
      return;
    }
    const toPath = joinPath(dirnamePath(path), verdict.name);
    if (toPath !== path && toPath !== lastSentRef.current) {
      lastSentRef.current = toPath;
      onRename(toPath).catch(() => {
        lastSentRef.current = null;
      });
    }
  };

  return (
    <input
      value={draft}
      aria-label="Note title"
      spellCheck={false}
      className="w-full bg-transparent text-2xl font-medium tracking-tight text-ink-2 outline-none placeholder:text-ink-3"
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
