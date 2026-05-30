// json-render catalog for agent-authored widget panels.
//
// Components map onto @repo/ui primitives so generated widgets match the app.
// Generated widgets are trusted; live actions run through main-process guards.

import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { z } from "zod";

import { WIDGET_ACTION_DESCRIPTIONS, WIDGET_COMPONENT_DESCRIPTIONS } from "@/shared/widget-spec";

const gap = z.enum(["sm", "md", "lg"]).optional();
const textSize = z.enum(["xs", "sm", "base"]).optional();
const buttonVariant = z
  .enum(["default", "outline", "ghost", "secondary", "destructive"])
  .optional();
const buttonSize = z.enum(["xs", "sm", "default", "lg"]).optional();

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
      description: WIDGET_COMPONENT_DESCRIPTIONS.Stack,
    },
    Row: {
      props: z.object({ bordered: z.boolean().optional() }),
      description: WIDGET_COMPONENT_DESCRIPTIONS.Row,
    },
    Section: {
      props: z.object({ title: z.string().optional() }),
      description: WIDGET_COMPONENT_DESCRIPTIONS.Section,
    },
    Heading: {
      props: z.object({ text: z.string(), level: z.enum(["1", "2", "3"]).optional() }),
      description: WIDGET_COMPONENT_DESCRIPTIONS.Heading,
    },
    Text: {
      props: z.object({
        text: z.string(),
        muted: z.boolean().optional(),
        size: textSize,
      }),
      description: WIDGET_COMPONENT_DESCRIPTIONS.Text,
    },
    TextBlock: {
      props: z.object({ title: z.string(), description: z.string().optional() }),
      description: WIDGET_COMPONENT_DESCRIPTIONS.TextBlock,
    },
    Button: {
      props: z.object({
        label: z.string(),
        variant: buttonVariant,
        size: buttonSize,
        disabled: z.boolean().optional(),
      }),
      description: WIDGET_COMPONENT_DESCRIPTIONS.Button,
    },
    Checkbox: {
      props: z.object({
        label: z.string(),
        description: z.string().optional(),
        checked: z.boolean().optional(),
        disabled: z.boolean().optional(),
      }),
      description: WIDGET_COMPONENT_DESCRIPTIONS.Checkbox,
    },
    Input: {
      props: z.object(textFieldProps),
      description: WIDGET_COMPONENT_DESCRIPTIONS.Input,
    },
    Textarea: {
      props: z.object({ ...textFieldProps, rows: z.number().optional() }),
      description: WIDGET_COMPONENT_DESCRIPTIONS.Textarea,
    },
    Card: {
      props: z.object({}),
      description: WIDGET_COMPONENT_DESCRIPTIONS.Card,
    },
    Separator: {
      props: z.object({}),
      description: WIDGET_COMPONENT_DESCRIPTIONS.Separator,
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
