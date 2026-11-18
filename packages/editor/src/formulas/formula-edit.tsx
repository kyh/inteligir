import { useId, useMemo, useState } from "react";
import { PathApi } from "platejs";
import type { Path, SlateEditor, TElement } from "platejs";
import { useEditorRef } from "platejs/react";

import type { Pill } from "@repo/editor/headless/formulas/displays";
import { renameIn } from "@repo/editor/headless/formulas/expression";
import { entryName, entryTextOf, pillFromEntryIn } from "@repo/editor/formulas/formula-entry";
import { pillEntries, pillOf } from "@repo/editor/headless/formulas/pill-nodes";
import type { PillEntry } from "@repo/editor/headless/formulas/pill-nodes";

// A new name for the pill at `at` spelled into every source that read its old one, so no formula
// loses what it names. Only the first pill to hold a name is read by it, so a later one's rename
// respells nothing.
const respelled = (
  pills: readonly PillEntry[],
  at: Path,
  from: string | undefined,
  to: string | undefined,
): { at: Path; source: string }[] => {
  if (from === undefined || to === undefined) {
    return [];
  }
  const read = pills.find(({ node }) => pillOf(node).name === from);
  return read === undefined || !PathApi.equals(read.at, at)
    ? []
    : pills
        .filter((pill) => pill !== read)
        .map((pill) => ({ at: pill.at, source: renameIn(pillOf(pill.node).source, from, to) }));
};

const applyFormulaEdit = (editor: SlateEditor, element: TElement, next: Pill): void => {
  const at = editor.api.findPath(element);
  if (at === undefined) {
    return;
  }
  const readers = respelled(pillEntries(editor.children), at, pillOf(element).name, next.name);
  editor.tf.withoutNormalizing(() => {
    editor.tf.setNodes({ name: next.name, source: next.source }, { at });
    for (const reader of readers) {
      editor.tf.setNodes({ source: reader.source }, { at: reader.at });
    }
  });
};

export const convertFormulaToText = (editor: SlateEditor, element: TElement): void => {
  const path = editor.api.findPath(element);
  if (path === undefined) {
    return;
  }
  const text = entryTextOf(pillOf(element));
  editor.tf.withoutNormalizing(() => {
    editor.tf.removeNodes({ at: path });
    editor.tf.insertNodes({ text }, { at: path, select: true });
  });
};

// the names the pills before `element` hold, each read from the first pill to hold it
const namesBefore = (editor: SlateEditor, element: TElement): ReadonlySet<string> => {
  const at = editor.api.findPath(element);
  return new Set(
    at === undefined
      ? []
      : pillEntries(editor.children)
          .filter((pill) => PathApi.isBefore(pill.at, at))
          .flatMap(({ node }) => pillOf(node).name ?? []),
  );
};

export const FormulaEditForm = ({ element, onDone }: { element: TElement; onDone: () => void }) => {
  const editor = useEditorRef();
  const [entry, setEntry] = useState(() => entryTextOf(pillOf(element)));
  // read as the editor opens: the compiler would key it on the entry too, a walk of the note per
  // keystroke
  const heldBefore = useMemo(() => namesBefore(editor, element), [editor, element]);
  const name = entryName(entry);
  const readElsewhere = name !== undefined && heldBefore.has(name) ? name : null;
  const noticeId = useId();
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const pill = pillFromEntryIn(editor, entry);
        if (pill !== null) {
          applyFormulaEdit(editor, element, pill);
        }
        onDone();
      }}
    >
      <input
        aria-label="Edit formula"
        aria-describedby={readElsewhere === null ? undefined : noticeId}
        className="w-48 rounded-sm bg-transparent px-1.5 py-0.5 font-mono text-body outline-none"
        value={entry}
        onChange={(event) => {
          setEntry(event.target.value);
        }}
        onFocus={(event) => {
          event.currentTarget.select();
        }}
      />
      {readElsewhere === null ? null : (
        <p id={noticeId} className="w-48 px-1.5 pb-0.5 text-caption text-muted-foreground">
          A formula earlier in the note is named {readElsewhere}, so {readElsewhere} reads that one.
        </p>
      )}
    </form>
  );
};
