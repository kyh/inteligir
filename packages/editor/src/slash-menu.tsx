import { SlashInputPlugin, SlashPlugin } from "@platejs/slash-command/react";
import { FileTextIcon } from "lucide-react";
import { KEYS } from "platejs";
import type { PlateElementProps } from "platejs/react";
import { PlateElement, createPlatePlugin } from "platejs/react";

import type { WikiTarget } from "@repo/notes/knowledge/link-graph-index";
import { isTemplatePath } from "@repo/notes/templates/folders";

import { useWikiTargets } from "@repo/editor/host";
import { insertTemplate } from "@repo/editor/insert-template";
import { useRichBlocksLocked } from "@repo/editor/kits/rich-block-lock-kit";
import { EmbedUrlDialogHost } from "@repo/editor/embed-url-dialog";
import {
  InlineCombobox,
  InlineComboboxContent,
  InlineComboboxEmpty,
  InlineComboboxGroup,
  InlineComboboxGroupLabel,
  InlineComboboxInput,
  InlineComboboxItem,
} from "@repo/editor/inline-combobox";
import { GROUPS } from "@repo/editor/slash-items";
import type { SlashItem } from "@repo/editor/slash-items";

const TEMPLATES_GROUP = "Templates";

// a template is a row only while it exists: the rows follow the host's live listing rather than
// being pinned in GROUPS, and the group is absent when the folder is.
const templateItems = (targets: readonly WikiTarget[]): SlashItem[] =>
  targets
    .filter((target) => isTemplatePath(target.path))
    .map((target) => ({
      description: target.path,
      icon: <FileTextIcon />,
      keywords: ["template"],
      label: target.title,
      onSelect: (editor) => {
        void insertTemplate(editor, target.path);
      },
      value: `template:${target.path}`,
    }));

const useTemplateItems = (): SlashItem[] => templateItems(useWikiTargets());

const SlashInputElement = (props: PlateElementProps) => {
  const { editor, element } = props;
  const templates = useTemplateItems();
  const locked = useRichBlocksLocked();
  const offered = locked
    ? GROUPS.map(({ group, items }) => ({
        group,
        items: items.filter((item) => item.richBlock !== true),
      }))
    : GROUPS;
  const groups =
    templates.length === 0 ? offered : [...offered, { group: TEMPLATES_GROUP, items: templates }];
  return (
    <PlateElement {...props} as="span">
      <InlineCombobox element={element} trigger="/">
        <InlineComboboxInput />
        <InlineComboboxContent variant="slash">
          <InlineComboboxEmpty>No results</InlineComboboxEmpty>
          {groups.map(({ group, items }) => (
            <InlineComboboxGroup key={group}>
              <InlineComboboxGroupLabel>{group}</InlineComboboxGroupLabel>
              {items.map((item) => (
                <InlineComboboxItem
                  key={item.value}
                  group={group}
                  value={item.value}
                  label={item.label}
                  keywords={item.keywords}
                  onClick={() => {
                    item.onSelect(editor);
                  }}
                >
                  <div className="flex size-9 items-center justify-center rounded-md border border-foreground/15 bg-background [&_svg]:size-5 [&_svg]:text-muted-foreground">
                    {item.icon}
                  </div>
                  <div className="ml-2.5 flex flex-1 flex-col truncate">
                    <span>{item.label}</span>
                    <span className="truncate text-body text-muted-foreground">
                      {item.description}
                    </span>
                  </div>
                </InlineComboboxItem>
              ))}
            </InlineComboboxGroup>
          ))}
        </InlineComboboxContent>
      </InlineCombobox>
      {props.children}
    </PlateElement>
  );
};

export const SlashKit = [
  SlashPlugin.configure({
    options: {
      triggerQuery: (editor) =>
        !editor.api.some({ match: { type: editor.getType(KEYS.codeBlock) } }),
    },
  }),
  SlashInputPlugin.withComponent(SlashInputElement),
  // the embed item's url prompt must live outside the self-unmounting combobox.
  createPlatePlugin({
    key: "embed-url-dialog",
    render: { afterEditable: () => <EmbedUrlDialogHost /> },
  }),
];
