// The `[[` picker: the query Plate's mention input holds, over the library's titles. A picked item
// is linked by its id, with the title it goes by now, so a rename never breaks it.

import { useState } from "react";
import { FilePlusIcon, FileTextIcon } from "lucide-react";
import { PlateElement } from "platejs/react";
import type { PlateElementProps } from "platejs/react";

import { titleKey } from "@repo/contract/library/derive-item";
import { shownTitle } from "@repo/contract/items/item-name";

import { useLibraryTitles } from "@repo/editor/host";
import {
  InlineCombobox,
  InlineComboboxContent,
  InlineComboboxEmpty,
  InlineComboboxGroup,
  InlineComboboxItem,
  InlineComboboxInput,
} from "@repo/editor/inline-combobox";
import { createAndLink, insertPageLink } from "@repo/editor/mention/mention-insert";
import { rankTitles } from "@repo/editor/mention/rank-titles";

const CREATE_VALUE = "__create__";

// Ranked and cut before any row mounts, never filtered per row: a row per item is a mount per
// item, each one re-filtering on every keystroke.
export const MENTION_PICKER_MAX_ROWS = 50;

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

  const createTitle = typed === "" || byKey.has(titleKey(typed)) ? null : typed;

  const shown = rankTitles(targets, typed).slice(0, MENTION_PICKER_MAX_ROWS);

  return (
    <PlateElement {...props} as="span">
      <InlineCombobox
        element={element}
        trigger="["
        value={value}
        setValue={setValue}
        closeOn={{ pick: linkWords, suffix: "]]", words: (words) => words.trim() }}
        filter={false}
      >
        <InlineComboboxInput />
        <InlineComboboxContent>
          <InlineComboboxEmpty>Nothing found</InlineComboboxEmpty>
          <InlineComboboxGroup>
            {shown.map((target) => (
              <InlineComboboxItem
                key={target.id}
                value={target.id}
                onClick={() => {
                  insertPageLink(editor, target);
                }}
              >
                <FileTextIcon className="mr-2 text-muted-foreground" />
                <span className="truncate">{shownTitle(target.title)}</span>
              </InlineComboboxItem>
            ))}
            {createTitle !== null && (
              <InlineComboboxItem
                value={CREATE_VALUE}
                onClick={() => {
                  void createAndLink(editor, createTitle);
                }}
              >
                <FilePlusIcon className="mr-2 text-muted-foreground" />
                <span>
                  Create <span className="font-medium">{createTitle}</span>
                </span>
              </InlineComboboxItem>
            )}
          </InlineComboboxGroup>
        </InlineComboboxContent>
      </InlineCombobox>
      {props.children}
    </PlateElement>
  );
};
