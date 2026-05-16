// ---------------------------------------------------------------------------
// json-render catalog for the settings panel.
//
// The catalog is the contract between the LLM and the renderer: prop schemas
// (so generated specs validate) plus action names (so emit("press") + the
// `on` field on each element wire up to real app behavior).
// ---------------------------------------------------------------------------

import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { z } from "zod";

const gap = z.enum(["sm", "md", "lg"]).optional();
const textSize = z.enum(["xs", "sm", "base"]).optional();
const buttonVariant = z.enum(["default", "outline", "ghost", "secondary", "destructive"]).optional();
const buttonSize = z.enum(["xs", "sm", "default", "lg"]).optional();

export const settingsCatalog = defineCatalog(schema, {
  components: {
    Stack: {
      props: z.object({ gap }),
      description: "Vertical stack container. Use as the top-level wrapper or nested groups.",
    },
    Row: {
      props: z.object({
        bordered: z.boolean().optional(),
      }),
      description:
        "Horizontal row with space-between layout, typically holding a label/description on the left and a control on the right. `bordered: true` wraps it in the standard settings card frame (default true).",
    },
    Section: {
      props: z.object({ title: z.string().optional() }),
      description:
        "A labeled group of rows. Renders a small uppercase title above its children (if `title` is provided).",
    },
    Heading: {
      props: z.object({
        text: z.string(),
        level: z.enum(["1", "2", "3"]).optional(),
      }),
      description: "Heading text. Defaults to level 3.",
    },
    Text: {
      props: z.object({
        text: z.string(),
        muted: z.boolean().optional(),
        size: textSize,
      }),
      description: "Inline text node. Use `muted: true` for secondary text.",
    },
    TextBlock: {
      props: z.object({
        title: z.string(),
        description: z.string().optional(),
      }),
      description:
        "Two-line text block: a foreground title and an optional muted description below it.",
    },
    Button: {
      props: z.object({
        label: z.string(),
        variant: buttonVariant,
        size: buttonSize,
        disabled: z.boolean().optional(),
      }),
      description:
        "Clickable button. Wire to an action by setting the element's `on: { press: { action: 'logout' } }` field.",
    },
    Checkbox: {
      props: z.object({
        label: z.string(),
        description: z.string().optional(),
        checked: z.boolean().optional(),
        disabled: z.boolean().optional(),
      }),
      description:
        "Checkbox with optional label and description. Two-way bind `checked` with `{ $bindState: '/path' }` for state, or pair with an action via the parent's `watch` to react to changes.",
    },
    Card: {
      props: z.object({}),
      description: "Bordered container for grouping arbitrary children.",
    },
  },
  actions: {
    logout: {
      description: "Log the user out of their connected AI provider account.",
    },
    newSession: {
      description: "Start a fresh agent session, clearing chat history.",
    },
    setNotifications: {
      params: z.object({ enabled: z.boolean() }),
      description: "Enable or disable OS notifications when the agent finishes a turn.",
    },
    resetUiSettings: {
      description: "Reset the settings UI spec and state back to factory defaults.",
    },
  },
});

export type SettingsCatalog = typeof settingsCatalog;
