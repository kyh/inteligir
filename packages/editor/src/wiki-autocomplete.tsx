// picking an attachment inserts `![[embed]]`: a bare link to a binary renders nothing useful.

import { useCallback, useState } from "react";
import { FilePlusIcon, FileTextIcon, PaperclipIcon } from "lucide-react";
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
  InlineComboboxGroupLabel,
  InlineComboboxItem,
  InlineComboboxInput,
} from "@repo/editor/inline-combobox";
import { insertWikiChipFromPicker } from "@repo/editor/wiki-insert";
import { WIKI_INPUT_KEY } from "@repo/editor/wiki-input-key";
import { composeWikiBody, wikiBodyForPath } from "@repo/editor/wiki-target";
import { useLinkResolver, useVaultActions, useWikiTargets } from "@repo/editor/host";
import type { WikiTarget } from "@repo/notes/knowledge/link-graph-index";
import { rankWikiTargets } from "@repo/notes/knowledge/rank-wiki-targets";
import { parseWikiBody } from "@repo/notes/markdown/remark-wiki-link";

const CREATE_VALUE = "__create__";

// Ranked and cut before any row mounts, never filtered per row: a row per vault entry is a mount
// per note, each one re-filtering on every keystroke.
export const WIKI_PICKER_MAX_ROWS = 50;

const WikiInputElement = (props: PlateElementProps) => {
  const { editor, element } = props;
  const { resolveWikiTarget } = useLinkResolver();
  const { createFileAt } = useVaultActions();
  const targets = useWikiTargets();
  const [value, setValue] = useState("");

  const typed = parseWikiBody(value);

  const complete = useCallback(
    (body: string, embed = false) => {
      insertWikiChipFromPicker(editor, body, embed);
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

  const showCreate = typed.target !== "" && resolveWikiTarget(typed.target) === null;

  // alias/anchor tails are passthrough, not search terms.
  const shown = rankWikiTargets(targets, typed.target).slice(0, WIKI_PICKER_MAX_ROWS);
  const notes = shown.filter((target) => target.type === "doc");
  const assets = shown.filter((target) => target.type === "asset");

  const itemFor = (target: WikiTarget) => (
    <InlineComboboxItem
      key={target.path}
      value={target.path}
      onClick={() => {
        complete(
          composeWikiBody(wikiBodyForPath(target.path, resolveWikiTarget), typed),
          target.type === "asset",
        );
      }}
    >
      {target.type === "doc" ? (
        <FileTextIcon className="mr-2 text-muted-foreground" />
      ) : (
        <PaperclipIcon className="mr-2 text-muted-foreground" />
      )}
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="truncate">{target.title}</span>
        <span className="truncate text-xs text-muted-foreground">{target.path}</span>
      </span>
    </InlineComboboxItem>
  );

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
          <InlineComboboxEmpty>No notes found</InlineComboboxEmpty>
          <InlineComboboxGroup>
            {notes.map(itemFor)}
            {showCreate && (
              <InlineComboboxItem
                value={CREATE_VALUE}
                onClick={() => {
                  void createFileAt(typed.target);
                  complete(composeWikiBody(typed.target, typed));
                }}
              >
                <FilePlusIcon className="mr-2 text-muted-foreground" />
                <span>
                  Create <span className="font-medium">{typed.target}</span>
                </span>
              </InlineComboboxItem>
            )}
          </InlineComboboxGroup>
          {assets.length > 0 && (
            <InlineComboboxGroup>
              <InlineComboboxGroupLabel>Attachments</InlineComboboxGroupLabel>
              {assets.map(itemFor)}
            </InlineComboboxGroup>
          )}
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
