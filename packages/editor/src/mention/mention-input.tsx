// The `[[` picker: the query Plate's mention input holds, over the library's titles. A picked item
// is linked by its id, with the title it goes by now, so a rename never breaks it.

import { useState } from "react";
import { FilePlusIcon, FileTextIcon } from "lucide-react";
import { PlateElement } from "platejs/react";
import type { PlateElementProps } from "platejs/react";

import { titleKey } from "@repo/contract/library/derive-item";
import { shownTitle } from "@repo/contract/items/item-name";

import { commitComboboxInput } from "@repo/editor/combobox-input";
import { useLibraryTitles } from "@repo/editor/host";
import type { LinkTarget } from "@repo/editor/host-io";
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
/** @internal */
export const MENTION_PICKER_MAX_ROWS = 50;

// the item a title names by the key the cell resolves a title by, the first the library lists
const itemTitled = (targets: readonly LinkTarget[], title: string): LinkTarget | null => {
  const key = titleKey(title);
  return key === "" ? null : (targets.find((target) => titleKey(target.title) === key) ?? null);
};

export const MentionInputElement = (props: PlateElementProps) => {
  const { editor, element } = props;
  const targets = useLibraryTitles();
  const [value, setValue] = useState("");

  const typed = value.trim();

  // typing `]]` links the item the words name, or leaves them the text they are
  const onValueChange = (next: string) => {
    const words = next.endsWith("]]") ? next.slice(0, -2).trim() : "";
    if (words === "") {
      setValue(next);
      return;
    }
    commitComboboxInput(editor, element, true);
    const named = itemTitled(targets, words);
    if (named === null) {
      editor.tf.insertText(`[${words}]]`);
      return;
    }
    insertPageLink(editor, named);
  };

  const createTitle = typed === "" || itemTitled(targets, typed) !== null ? null : typed;

  const shown = rankTitles(targets, typed).slice(0, MENTION_PICKER_MAX_ROWS);

  return (
    <PlateElement {...props} as="span">
      <InlineCombobox
        element={element}
        trigger="["
        value={value}
        setValue={onValueChange}
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
