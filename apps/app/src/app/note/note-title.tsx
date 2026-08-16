// The page title IS the filename: an editable H1 above the document whose
// commit renames the file. Enter commits and hands focus to the editor;
// Escape restores; a blur with changes commits too.

import { useEffect, useRef, useState } from "react";

export function noteStem(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name.endsWith(".md") ? name.slice(0, -".md".length) : name;
}

export function pathWithStem(path: string, stem: string): string {
  const slash = path.lastIndexOf("/");
  const dir = slash === -1 ? "" : path.slice(0, slash);
  const name = path.slice(slash + 1);
  const fileName = name.endsWith(".md") ? `${stem}.md` : stem;
  return dir === "" ? fileName : `${dir}/${fileName}`;
}

export interface NoteTitleProps {
  path: string;
  onRename: (toPath: string) => void;
  onSubmit: () => void;
}

export function NoteTitle({ path, onRename, onSubmit }: NoteTitleProps) {
  const stem = noteStem(path);
  const [draft, setDraft] = useState(stem);
  const escapedRef = useRef(false);
  // Enter commits and then moves focus, which fires the blur commit too; the
  // last-sent stem swallows that echo so one rename goes out per edit.
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
    const next = draft.trim();
    if (next === "" || next.includes("/")) {
      setDraft(stem);
      return;
    }
    if (next !== stem && next !== lastSentRef.current) {
      lastSentRef.current = next;
      onRename(pathWithStem(path, next));
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
