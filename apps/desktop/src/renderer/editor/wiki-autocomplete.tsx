// `[[` wiki autocomplete — the third inline-combobox consumer (after slash
// and emoji). Typing `[` after `[` swaps in a trigger element listing every
// linkable target (listWikiTargets, fuzzy-filtered): notes first, then
// attachments in their own group — picking an attachment inserts an
// `![[embed]]` chip (a bare link to a binary renders nothing useful).
// Enter/click completes the chip and the closing brackets. `|alias` and
// `#anchor` typed into the query pass straight through into the chip body,
// typing `]]` completes verbatim (fluent-typing parity with the kit's `]]`
// input rule), and an unresolved query offers a create-note entry that also
// inserts the (now-resolving) chip.

import { useCallback, useEffect, useState } from "react";
import { FilePlusIcon, FileTextIcon, PaperclipIcon } from "lucide-react";
import { KEYS, createTSlatePlugin, type PluginConfig } from "platejs";
import { PlateElement, createPlatePlugin, type PlateElementProps } from "platejs/react";
import {
  withTriggerCombobox,
  filterWords,
  type TriggerComboboxPluginOptions,
} from "@platejs/combobox";

import { getBridge } from "@renderer/lib/bridge";
import { commitComboboxInput } from "@renderer/editor/combobox-input";
import {
  InlineCombobox,
  InlineComboboxContent,
  InlineComboboxEmpty,
  InlineComboboxGroup,
  InlineComboboxGroupLabel,
  InlineComboboxItem,
  InlineComboboxInput,
  type FilterFn,
} from "@renderer/editor/inline-combobox";
import { insertWikiChipFromPicker } from "@renderer/editor/wiki-insert";
import { WIKI_INPUT_KEY } from "@renderer/editor/wiki-input-key";
import { composeWikiBody, wikiBodyForPath } from "@renderer/editor/wiki-target";
import { useVault } from "@renderer/workspace/vault-context";
import type { WikiTarget } from "@repo/domain/knowledge/link-graph-index";
import { parseWikiBody } from "@repo/domain/markdown/remark-wiki-link";

const CREATE_VALUE = "__create__";

// The query's alias/anchor tails are passthrough, not search terms — filter
// on the target part only. The create entry self-manages its visibility.
const wikiFilter: FilterFn = (item, search) => {
  if (item.value === CREATE_VALUE) return true;
  const target = parseWikiBody(search).target;
  if (target === "") return true;
  const terms = [item.value, ...(item.keywords ?? []), item.label].filter(
    (k): k is string => typeof k === "string" && k !== "",
  );
  return terms.some((keyword) => filterWords(keyword, target));
};

function WikiInputElement(props: PlateElementProps) {
  const { children, editor, element } = props;
  const { resolveWikiTarget, createFileAt } = useVault();
  const [value, setValue] = useState("");
  const [targets, setTargets] = useState<WikiTarget[]>([]);

  useEffect(() => {
    let cancelled = false;
    getBridge()
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

  // Typing the closing `]]` completes the chip verbatim, exactly like the
  // editor-level input rule would have without the picker in the way.
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

  // The engine returns docs first, assets after; split so each renders in its
  // own labeled group. Picking an attachment inserts an embed (`![[asset]]`).
  const notes = targets.filter((target) => target.type === "doc");
  const assets = targets.filter((target) => target.type === "asset");

  const itemFor = (target: WikiTarget) => (
    <InlineComboboxItem
      key={target.path}
      value={target.path}
      label={target.title}
      // Aliases match too; picking an alias-matched row inserts the canonical
      // `[[target]]` (composeWikiBody below), not `[[target|alias]]`.
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
                  // Create the note in the background (no navigation) so the
                  // inserted chip resolves immediately.
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
      // Only a `[` immediately before the typed `[` opens the picker — plain
      // brackets elsewhere stay plain text.
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
