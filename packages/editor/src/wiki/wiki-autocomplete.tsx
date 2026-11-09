// a picked item is linked by its id, with the title it goes by now, so a rename never breaks it.

import { useCallback, useState } from "react";
import { FilePlusIcon, FileTextIcon } from "lucide-react";
import { KEYS, createTSlatePlugin } from "platejs";
import type { PluginConfig } from "platejs";
import { PlateElement, createPlatePlugin } from "platejs/react";
import type { PlateElementProps } from "platejs/react";
import { withTriggerCombobox } from "@platejs/combobox";
import type { TriggerComboboxPluginOptions } from "@platejs/combobox";

import { commitComboboxInput } from "@repo/editor/combobox-input";
import {
  InlineCombobox,
  InlineComboboxContent,
  InlineComboboxEmpty,
  InlineComboboxGroup,
  InlineComboboxItem,
  InlineComboboxInput,
} from "@repo/editor/inline-combobox";
import { createLinkedNote, insertWikiChipFromPicker } from "@repo/editor/wiki/wiki-insert";
import { WIKI_INPUT_KEY } from "@repo/editor/wiki/wiki-input-key";
import { useLinkResolver, useLinkTargets } from "@repo/editor/host";
import type { LinkTarget } from "@repo/editor/host-io";
import { shownTitle } from "@repo/contract/items/item-name";
import { rankWikiTargets } from "@repo/editor/knowledge/rank-wiki-targets";
import { parseWikiBody, serializeWikiBody } from "@repo/editor/markdown/remark-wiki-link";

const CREATE_VALUE = "__create__";

// Ranked and cut before any row mounts, never filtered per row: a row per item is a mount per
// item, each one re-filtering on every keystroke.
/** @internal */
export const WIKI_PICKER_MAX_ROWS = 50;

const WikiInputElement = (props: PlateElementProps) => {
  const { editor, element } = props;
  const { resolveWikiTarget } = useLinkResolver();
  const targets = useLinkTargets();
  const [value, setValue] = useState("");

  const typed = parseWikiBody(value);

  const complete = useCallback(
    (body: string) => {
      insertWikiChipFromPicker(editor, body);
    },
    [editor],
  );

  // typing `]]` completes verbatim, matching the editor-level input rule.
  const onValueChange = useCallback(
    (next: string) => {
      if (next.endsWith("]]") && next.slice(0, -2) !== "") {
        commitComboboxInput(editor, element, true);
        complete(next.slice(0, -2));
        return;
      }
      setValue(next);
    },
    [editor, element, complete],
  );

  const createBody =
    typed.target === "" || resolveWikiTarget(typed.target) !== null
      ? null
      : serializeWikiBody(typed);

  // alias/anchor tails are passthrough, not search terms.
  const shown = rankWikiTargets(targets, typed.target).slice(0, WIKI_PICKER_MAX_ROWS);

  // by its id after the pipe, unless the person typed an alias there; a title holding a bracket
  // has no wiki spelling, so it is not offered
  const itemFor = (target: LinkTarget) => {
    const body = serializeWikiBody({
      ...typed,
      alias: typed.alias ?? target.id,
      target: target.title,
    });
    return body === null ? null : (
      <InlineComboboxItem
        key={target.id}
        value={target.id}
        onClick={() => {
          complete(body);
        }}
      >
        <FileTextIcon className="mr-2 text-muted-foreground" />
        <span className="truncate">{shownTitle(target.title)}</span>
      </InlineComboboxItem>
    );
  };

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
            {shown.map(itemFor)}
            {createBody !== null && (
              <InlineComboboxItem
                value={CREATE_VALUE}
                onClick={() => {
                  void createLinkedNote(typed.target);
                  complete(createBody);
                }}
              >
                <FilePlusIcon className="mr-2 text-muted-foreground" />
                <span>
                  Create <span className="font-medium">{typed.target}</span>
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

type WikiTriggerConfig = PluginConfig<"wiki_trigger", TriggerComboboxPluginOptions>;

export const WikiAutocompleteKit = [
  createTSlatePlugin<WikiTriggerConfig>({
    key: "wiki_trigger",
    options: {
      createComboboxInput: () => ({ children: [{ text: "" }], type: WIKI_INPUT_KEY }),
      trigger: "[",
      triggerPreviousCharPattern: /^\[$/u,
      triggerQuery: (editor) =>
        !editor.api.some({ match: { type: editor.getType(KEYS.codeBlock) } }),
    },
  }).overrideEditor(withTriggerCombobox),
  createPlatePlugin({
    key: WIKI_INPUT_KEY,
    node: { isElement: true, isInline: true, isVoid: true },
  }).withComponent(WikiInputElement),
];
