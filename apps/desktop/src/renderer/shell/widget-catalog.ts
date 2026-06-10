// json-render catalog for agent-authored widget panels.
//
// Components map onto @repo/ui primitives so generated widgets match the app.
// Generated widgets are trusted; live actions run through main-process guards.
//
// This file is deliberately a thin adapter. The component vocabulary — the
// per-component TypeBox prop schemas and the agent-facing prose — lives in
// shared/widget-spec.ts and is enforced at the write boundary by
// parseWidgetSpec (and re-run at render time by widget-viewer's
// validateWidgetProps call). defineCatalog requires zod schemas, so each
// component entry wraps its shared TypeBox schema in a z.custom that
// delegates to Value.Check. The static prop type also derives from the same
// shared schema, which keeps defineRegistry's compile-time check of the
// component implementations rooted in the single source of truth.

import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { Value } from "@sinclair/typebox/value";
import { z } from "zod";

import {
  componentDescription,
  componentPropsSchema,
  WIDGET_ACTION_DESCRIPTIONS,
  type JsonWidgetComponentType,
  type WidgetComponentProps,
} from "@/shared/widget-spec";

function component<K extends JsonWidgetComponentType>(type: K) {
  return {
    props: z.custom<WidgetComponentProps<K>>((value) =>
      Value.Check(componentPropsSchema(type), value),
    ),
    description: componentDescription(type),
  };
}

export const widgetCatalog = defineCatalog(schema, {
  components: {
    Stack: component("Stack"),
    Section: component("Section"),
    Row: component("Row"),
    Grid: component("Grid"),
    Heading: component("Heading"),
    Text: component("Text"),
    TextBlock: component("TextBlock"),
    Markdown: component("Markdown"),
    Badge: component("Badge"),
    Button: component("Button"),
    Checkbox: component("Checkbox"),
    Switch: component("Switch"),
    Input: component("Input"),
    Textarea: component("Textarea"),
    Select: component("Select"),
    RadioGroup: component("RadioGroup"),
    Slider: component("Slider"),
    Avatar: component("Avatar"),
    Spinner: component("Spinner"),
    Image: component("Image"),
    Chart: component("Chart"),
    Card: component("Card"),
    Accent: component("Accent"),
    Collapsible: component("Collapsible"),
    Tabs: component("Tabs"),
    Table: component("Table"),
    TableHeader: component("TableHeader"),
    TableBody: component("TableBody"),
    TableRow: component("TableRow"),
    TableHead: component("TableHead"),
    TableCell: component("TableCell"),
    Dialog: component("Dialog"),
    Drawer: component("Drawer"),
    Popover: component("Popover"),
    Tooltip: component("Tooltip"),
    DropdownMenu: component("DropdownMenu"),
    MenuItem: component("MenuItem"),
    Separator: component("Separator"),
  },
  actions: {
    notify: {
      params: z.object({
        message: z.string(),
        variant: z.enum(["default", "success", "error"]).optional(),
      }),
      description: `${WIDGET_ACTION_DESCRIPTIONS.notify} Variant controls color.`,
    },
    openUrl: {
      params: z.object({ url: z.string().url() }),
      description: WIDGET_ACTION_DESCRIPTIONS.openUrl,
    },
    sendPrompt: {
      params: z.object({ prompt: z.string() }),
      description: WIDGET_ACTION_DESCRIPTIONS.sendPrompt,
    },
    generateText: {
      params: z.object({
        prompt: z.string(),
        into: z.string(),
        system: z.string().optional(),
      }),
      description:
        `${WIDGET_ACTION_DESCRIPTIONS.generateText} Bind a Text's \`text\` to that path ` +
        "with { $bindState } to show it.",
    },
    fetchUrl: {
      params: z.object({ url: z.string().url(), into: z.string() }),
      description: WIDGET_ACTION_DESCRIPTIONS.fetchUrl,
    },
    fetchJson: {
      params: z.object({
        url: z.string().url(),
        paths: z.record(z.string(), z.string()),
        error: z.string().optional(),
      }),
      description: WIDGET_ACTION_DESCRIPTIONS.fetchJson,
    },
    setNow: {
      params: z.object({ paths: z.record(z.string(), z.string()) }),
      description: WIDGET_ACTION_DESCRIPTIONS.setNow,
    },
    callTool: {
      params: z.object({
        tool: z.string(),
        input: z.record(z.string(), z.unknown()).optional(),
        into: z.string(),
        error: z.string().optional(),
        select: z.string().optional(),
      }),
      description: WIDGET_ACTION_DESCRIPTIONS.callTool,
    },
  },
});
