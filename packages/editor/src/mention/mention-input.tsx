// The `[[` picker: the query Plate's mention input holds, over the library's titles. A picked item
// is linked by its id, with the title it goes by now, so a rename never breaks it.

import { useState } from "react";
import { FilePlusIcon, FileTextIcon } from "lucide-react";
import { PlateElement } from "platejs/react";
import type { PlateElementProps } from "platejs/react";

import { titleKey } from "@repo/contract/library/derive-item";
import { shownTitle } from "@repo/contract/items/item-name";

import { useLibraryTitles } from "@repo/editor/host";
import type { LinkTarget } from "@repo/editor/host-io";
import { InlineCombobox } from "@repo/editor/inline-combobox";
import type { PickerRow } from "@repo/editor/inline-combobox";
import { createAndLink, insertPageLink } from "@repo/editor/mention/mention-insert";
import { rankTitles } from "@repo/editor/mention/rank-titles";

const CREATE_VALUE = "__create__";

// Ranked and cut before any row mounts, never filtered per row: a row per item is a mount per
// item, each one re-filtering on every keystroke.
export const MENTION_PICKER_MAX_ROWS = 50;

// an item to link, or the note to make under the typed title
type MentionRow = PickerRow &
  (
    | { readonly kind: "link"; readonly target: LinkTarget }
    | { readonly kind: "create"; readonly title: string }
  );

export const MentionInputElement = (props: PlateElementProps) => {
  const { editor, element } = props;
  const { byKey, targets } = useLibraryTitles();
  const [value, setValue] = useState("");

  const typed = value.trim();

  // typing `]]` links the item the words name, or leaves them the text they are
  const linkWords = (words: string) => {
    const named = byKey.get(titleKey(words));
    if (named === undefined) {
      editor.tf.insertText(`[${words}]]`);
      return;
    }
    insertPageLink(editor, named);
  };

  const rows = rankTitles(targets, typed)
    .slice(0, MENTION_PICKER_MAX_ROWS)
    .map((target): MentionRow => ({
      kind: "link",
      onSelect: (picked) => {
        insertPageLink(picked, target);
      },
      target,
      value: target.id,
    }));
  if (typed !== "" && !byKey.has(titleKey(typed))) {
    rows.push({
      kind: "create",
      onSelect: (picked) => {
        void createAndLink(picked, typed);
      },
      title: typed,
      value: CREATE_VALUE,
    });
  }

  return (
    <PlateElement {...props} as="span">
      <InlineCombobox
        closeOn={{ pick: linkWords, suffix: "]]", words: (words) => words.trim() }}
        element={element}
        empty="Nothing found"
        filter={null}
        groups={[{ items: rows }]}
        query={{ onChange: setValue, value }}
        trigger="["
      >
        {(row) =>
          row.kind === "link" ? (
            <>
              <FileTextIcon className="mr-2 text-muted-foreground" />
              <span className="truncate">{shownTitle(row.target.title)}</span>
            </>
          ) : (
            <>
              <FilePlusIcon className="mr-2 text-muted-foreground" />
              <span>
                Create <span className="font-medium">{row.title}</span>
              </span>
            </>
          )
        }
      </InlineCombobox>
      {props.children}
    </PlateElement>
  );
};
