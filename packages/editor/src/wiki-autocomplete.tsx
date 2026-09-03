// picking an attachment inserts `![[embed]]`: a bare link to a binary renders nothing useful.

import { useCallback, useEffect, useState } from "react";
import { FilePlusIcon, FileTextIcon, PaperclipIcon } from "lucide-react";
import { KEYS, createTSlatePlugin, type PluginConfig } from "platejs";
import { PlateElement, createPlatePlugin, type PlateElementProps } from "platejs/react";
import {
  withTriggerCombobox,
  filterWords,
  type TriggerComboboxPluginOptions,
} from "@platejs/combobox";

import { getEditorHostIo } from "@repo/editor/host-io";
import { commitComboboxInput } from "@repo/editor/combobox-input";
import {
  InlineCombobox,
  InlineComboboxContent,
  InlineComboboxEmpty,
  InlineComboboxGroup,
  InlineComboboxGroupLabel,
  InlineComboboxItem,
  InlineComboboxInput,
  type FilterFn,
} from "@repo/editor/inline-combobox";
import { insertWikiChipFromPicker } from "@repo/editor/wiki-insert";
import { WIKI_INPUT_KEY } from "@repo/editor/wiki-input-key";
import { composeWikiBody, wikiBodyForPath } from "@repo/editor/wiki-target";
import { useVaultActions, useWikiResolver } from "@repo/editor/host";
import type { WikiTarget } from "@repo/notes/knowledge/link-graph-index";
import { parseWikiBody } from "@repo/notes/markdown/remark-wiki-link";

const CREATE_VALUE = "__create__";

// alias/anchor tails are passthrough, not search terms.
const wikiFilter: FilterFn = (item, search) => {
  if (item.value === CREATE_VALUE) return true;
  const target = parseWikiBody(search).target;
  if (target === "") return true;
  const terms = [item.value, ...(item.keywords ?? []), item.label].filter(
    (k): k is string => k !== undefined && k !== "",
  );
  return terms.some((keyword) => filterWords(keyword, target));
};

function WikiInputElement(props: PlateElementProps) {
  const { children, editor, element } = props;
  const { resolveWikiTarget } = useWikiResolver();
  const { createFileAt } = useVaultActions();
  const [value, setValue] = useState("");
  const [targets, setTargets] = useState<WikiTarget[]>([]);

  useEffect(() => {
    let cancelled = false;
    getEditorHostIo()
      .listWikiTargets()
      .then((list) => {
        if (!cancelled) setTargets(list);
        return undefined;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const typed = parseWikiBody(value);

  const complete = useCallback(
    (body: string, embed = false) => insertWikiChipFromPicker(editor, body, embed),
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

  const notes = targets.filter((target) => target.type === "doc");
  const assets = targets.filter((target) => target.type === "asset");

  const itemFor = (target: WikiTarget) => (
    <InlineComboboxItem
      key={target.path}
      value={target.path}
      label={target.title}
      keywords={[target.title, ...(target.aliases ?? [])]}
      onClick={() =>
        complete(
          composeWikiBody(wikiBodyForPath(target.path, resolveWikiTarget), typed),
          target.type === "asset",
        )
      }
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
        filter={wikiFilter}
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
      {children}
    </PlateElement>
  );
}

type WikiTriggerConfig = PluginConfig<"wiki_trigger", TriggerComboboxPluginOptions>;

export const WikiAutocompleteKit = [
  createTSlatePlugin<WikiTriggerConfig>({
    key: "wiki_trigger",
    options: {
      trigger: "[",
      triggerPreviousCharPattern: /^\[$/,
      triggerQuery: (editor) =>
        !editor.api.some({ match: { type: editor.getType(KEYS.codeBlock) } }),
      createComboboxInput: () => ({ children: [{ text: "" }], type: WIKI_INPUT_KEY }),
    },
  }).overrideEditor(withTriggerCombobox),
  createPlatePlugin({
    key: WIKI_INPUT_KEY,
    node: { isElement: true, isInline: true, isVoid: true },
  }).withComponent(WikiInputElement),
];
