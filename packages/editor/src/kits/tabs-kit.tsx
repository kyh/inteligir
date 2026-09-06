// Hidden panels stay mounted so Slate's model and pending edits survive switching; the active
// index is React state, never a node prop, because switching is not an edit.

import { createContext, useContext, useMemo, useState } from "react";
import { createSlatePlugin, ElementApi, type SlateEditor, type TElement } from "platejs";
import {
  PlateElement,
  useEditorRef,
  useElement,
  usePath,
  type PlateElementProps,
} from "platejs/react";
import { PlusIcon, XIcon } from "lucide-react";

import { Tooltip } from "@repo/ui/components/tooltip";
import { cn } from "cn";

import { stringProp } from "@repo/editor/node-props";

const ActiveTabContext = createContext(0);

function panelsOf(element: TElement): { label: string; index: number }[] {
  return element.children.flatMap((child, index) => {
    if (!ElementApi.isElement(child) || child.type !== "tab_panel") return [];
    return [{ index, label: stringProp(child, "label") ?? "Tab" }];
  });
}

function TabGroupElement(props: PlateElementProps) {
  const editor = useEditorRef();
  const element = useElement();
  const path = usePath();
  const panels = useMemo(() => panelsOf(element), [element]);
  const [active, setActive] = useState(0);
  const shown = Math.min(active, Math.max(panels.length - 1, 0));

  const addPanel = (): void => {
    if (path === undefined) return;
    editor.tf.insertNodes(
      {
        children: [{ children: [{ text: "" }], type: "p" }],
        label: `Tab ${String(panels.length + 1)}`,
        type: "tab_panel",
      },
      { at: [...path, element.children.length] },
    );
    setActive(panels.length);
  };

  const removePanel = (index: number): void => {
    if (path === undefined || panels.length <= 1) return;
    editor.tf.removeNodes({ at: [...path, index] });
    setActive((current) =>
      Math.max(0, current > index ? current - 1 : Math.min(current, panels.length - 2)),
    );
  };

  return (
    <PlateElement
      {...props}
      className="my-2 rounded-md border border-border"
      attributes={{ ...props.attributes, "data-tab-group": "" }}
    >
      <div
        contentEditable={false}
        className="flex items-center gap-1 border-b border-border bg-muted/40 px-1.5 py-1"
      >
        {panels.map((panel) => (
          <span key={panel.index} className="group/tab relative">
            <button
              type="button"
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onClick={() => {
                setActive(panel.index);
              }}
              className={cn(
                "rounded-sm px-2 py-0.5 text-xs font-medium",
                panel.index === shown
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {panel.label}
            </button>
            {panels.length > 1 && panel.index === shown ? (
              <Tooltip content={`Remove ${panel.label}`}>
                <button
                  type="button"
                  aria-label={`Remove ${panel.label}`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                  }}
                  onClick={() => {
                    removePanel(panel.index);
                  }}
                  className="absolute -top-1 -right-1 hidden size-3.5 items-center justify-center rounded-full bg-muted text-muted-foreground group-hover/tab:flex hover:text-foreground [&_svg]:size-2.5"
                >
                  <XIcon />
                </button>
              </Tooltip>
            ) : null}
          </span>
        ))}
        <Tooltip content="Add tab">
          <button
            type="button"
            aria-label="Add tab"
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={addPanel}
            className="ml-auto flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-3.5"
          >
            <PlusIcon />
          </button>
        </Tooltip>
      </div>
      <ActiveTabContext.Provider value={shown}>{props.children}</ActiveTabContext.Provider>
    </PlateElement>
  );
}

function TabPanelElement(props: PlateElementProps) {
  const active = useContext(ActiveTabContext);
  const path = usePath();
  const index = path === undefined ? 0 : (path.at(-1) ?? 0);
  const label = stringProp(props.element, "label") ?? "Tab";
  return (
    <PlateElement
      {...props}
      className={cn("px-3 py-2 print:block", index === active ? "" : "hidden")}
      attributes={{ ...props.attributes, "data-tab-panel": "" }}
    >
      <div
        contentEditable={false}
        className="mb-1 hidden text-xs font-semibold text-muted-foreground print:block"
      >
        {label}
      </div>
      {props.children}
    </PlateElement>
  );
}

const tabGroupBasePlugin = createSlatePlugin({
  key: "tab_group",
  node: { isElement: true },
});

const tabPanelBasePlugin = createSlatePlugin({
  key: "tab_panel",
  node: { isElement: true },
});

export const TabsBaseKit = [tabGroupBasePlugin, tabPanelBasePlugin];

export const TabsKit = [
  tabGroupBasePlugin.withComponent(TabGroupElement),
  tabPanelBasePlugin.withComponent(TabPanelElement),
];

export function insertTabGroup(editor: SlateEditor): void {
  editor.tf.insertNodes({
    children: [
      {
        children: [{ children: [{ text: "" }], type: "p" }],
        label: "Tab 1",
        type: "tab_panel",
      },
      {
        children: [{ children: [{ text: "" }], type: "p" }],
        label: "Tab 2",
        type: "tab_panel",
      },
    ],
    type: "tab_group",
  });
}
