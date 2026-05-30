// ---------------------------------------------------------------------------
// json-render catalog for agent-authored widget panels.
//
// Components map onto @repo/ui primitives so generated widgets match the app.
// Generated widgets are trusted; live actions run through main-process guards.
// ---------------------------------------------------------------------------

import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { z } from "zod";

import { WIDGET_ACTION_DESCRIPTIONS } from "@/shared/widget-spec";

const gap = z.enum(["sm", "md", "lg"]).optional();
const textSize = z.enum(["xs", "sm", "base"]).optional();
const buttonVariant = z
  .enum(["default", "outline", "ghost", "secondary", "destructive"])
  .optional();
const buttonSize = z.enum(["xs", "sm", "default", "lg"]).optional();

// Shared by Input + Textarea (Textarea adds `rows`).
const textFieldProps = {
  label: z.string().optional(),
  placeholder: z.string().optional(),
  value: z.string().optional(),
  disabled: z.boolean().optional(),
};

export const widgetCatalog = defineCatalog(schema, {
  components: {
    Stack: {
      props: z.object({ gap }),
      description: "Vertical stack container. Use as the top-level wrapper or nested groups.",
    },
    Row: {
      props: z.object({ bordered: z.boolean().optional() }),
      description:
        "Horizontal row with space-between layout. `bordered: true` (default) wraps it in the standard card frame.",
    },
    Section: {
      props: z.object({ title: z.string().optional() }),
      description:
        "Labeled group of rows. Renders a small uppercase title above its children if `title` is set.",
    },
    Heading: {
      props: z.object({ text: z.string(), level: z.enum(["1", "2", "3"]).optional() }),
      description: "Heading text. Defaults to level 3 (small muted label).",
    },
    Text: {
      props: z.object({
        text: z.string(),
        muted: z.boolean().optional(),
        size: textSize,
      }),
      description:
        "Text node. Default size is 'sm' (12px); 'xs' is 11px for captions, 'base' is 14px.",
    },
    TextBlock: {
      props: z.object({ title: z.string(), description: z.string().optional() }),
      description: "Two-line text: foreground title + optional muted description below.",
    },
    Button: {
      props: z.object({
        label: z.string(),
        variant: buttonVariant,
        size: buttonSize,
        disabled: z.boolean().optional(),
      }),
      description:
        "Clickable button. Wire to an action by setting the element's `on: { press: { action: 'notify', params: {...} } }`.",
    },
    Checkbox: {
      props: z.object({
        label: z.string(),
        description: z.string().optional(),
        checked: z.boolean().optional(),
        disabled: z.boolean().optional(),
      }),
      description:
        "Checkbox with optional label + description. Two-way bind `checked` via { $bindState: '/path' }.",
    },
    Input: {
      props: z.object(textFieldProps),
      description: "Text input. Two-way bind `value` via { $bindState: '/path' }.",
    },
    Textarea: {
      props: z.object({ ...textFieldProps, rows: z.number().optional() }),
      description: "Multi-line text input. Two-way bind `value` via { $bindState: '/path' }.",
    },
    Card: {
      props: z.object({}),
      description: "Bordered container for grouping arbitrary children.",
    },
    Separator: {
      props: z.object({}),
      description: "Horizontal hairline divider.",
    },
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
  },
});
