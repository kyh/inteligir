// Generated widget spec language. Shared by the agent tool contract, main-side
// validation, and renderer catalog.

import type { UIElement, VisibilityCondition } from "@json-render/core";

export type JsonWidgetComponentType =
  | "Stack"
  | "Section"
  | "Row"
  | "Grid"
  | "Heading"
  | "Text"
  | "TextBlock"
  | "Markdown"
  | "Badge"
  | "Button"
  | "Checkbox"
  | "Switch"
  | "Input"
  | "Textarea"
  | "Select"
  | "RadioGroup"
  | "Slider"
  | "Avatar"
  | "Spinner"
  | "Image"
  | "Card"
  | "Collapsible"
  | "Tabs"
  | "Separator";

export const JSON_WIDGET_COMPONENT_TYPES: readonly JsonWidgetComponentType[] = [
  "Stack",
  "Section",
  "Row",
  "Grid",
  "Heading",
  "Text",
  "TextBlock",
  "Markdown",
  "Badge",
  "Button",
  "Checkbox",
  "Switch",
  "Input",
  "Textarea",
  "Select",
  "RadioGroup",
  "Slider",
  "Avatar",
  "Spinner",
  "Image",
  "Card",
  "Collapsible",
  "Tabs",
  "Separator",
];

export const WIDGET_COMPONENT_DESCRIPTIONS: Record<JsonWidgetComponentType, string> = {
  Stack:
    "Vertical stack container. Props: { gap?: 'sm'|'md'|'lg' }. Use as the top-level wrapper or nested groups.",
  Section:
    "Labeled group of rows. Props: { title?: string }. Renders a small uppercase title when set.",
  Row: "Horizontal row with space-between layout. Props: { bordered?: boolean }. Bordered by default.",
  Grid: "Multi-column grid container. Props: { columns?: number (default 2), gap?: 'sm'|'md'|'lg' }. Lays children out in equal columns.",
  Heading: "Heading text. Props: { text: string, level?: '1'|'2'|'3' }. Defaults to level 3.",
  Text: "Text node. Props: { text: string, muted?: boolean, size?: 'xs'|'sm'|'base' }.",
  TextBlock:
    "Two-line text. Props: { title: string, description?: string }. Use for label/value summaries.",
  Markdown:
    "Rendered markdown block. Props: { content: string }. Bind `content` via { $bindState: '/path' } to show generated/fetched text.",
  Badge:
    "Inline status badge. Props: { text: string, variant?: 'default'|'secondary'|'destructive'|'outline'|'ghost' }.",
  Button:
    "Clickable button. Props: { label: string, variant?: 'default'|'outline'|'ghost'|'secondary'|'destructive', size?: 'xs'|'sm'|'default'|'lg', disabled?: boolean }. Wire `on.press` to actions.",
  Checkbox:
    "Checkbox. Props: { label: string, description?: string, checked?: boolean, disabled?: boolean }. Two-way bind `checked` via { $bindState: '/path' }.",
  Switch:
    "Toggle switch. Props: { label: string, description?: string, checked?: boolean, disabled?: boolean }. Two-way bind `checked` via { $bindState: '/path' }.",
  Input:
    "Text input. Props: { label?: string, placeholder?: string, value?: string, disabled?: boolean }. Two-way bind `value` via { $bindState: '/path' }.",
  Textarea:
    "Multi-line input. Props: { label?: string, placeholder?: string, value?: string, rows?: number, disabled?: boolean }. Two-way bind `value`.",
  Select:
    "Dropdown select. Props: { label?: string, placeholder?: string, value?: string, options: { label: string, value: string }[], disabled?: boolean }. Two-way bind `value`.",
  RadioGroup:
    "Single-choice radio group. Props: { label?: string, value?: string, options: { label: string, value: string, description?: string }[], disabled?: boolean }. Two-way bind `value`.",
  Slider:
    "Numeric slider. Props: { label?: string, value?: number, min?: number, max?: number, step?: number, disabled?: boolean }. Two-way bind `value` (number).",
  Avatar:
    "User avatar. Props: { src?: string, fallback?: string, size?: 'sm'|'default'|'lg' }. Shows `fallback` initials when no image.",
  Spinner:
    "Loading spinner. Props: { size?: 'sm'|'default'|'lg' }. Pair with generateText/fetchUrl and a `visible` condition.",
  Image: "Image. Props: { src: string, alt?: string, rounded?: boolean }. Square by default; set rounded: true for rounded corners.",
  Card: "Bordered container. Props: {}. Use to group arbitrary children.",
  Collapsible:
    "Collapsible disclosure. Props: { title: string, defaultOpen?: boolean }. Children show when expanded.",
  Tabs: "Tabbed container. Props: { tabs: { label: string, value: string }[] }. Provide exactly one child per tab — child N is the panel for tab N, paired by position. Don't put a `visible` condition on a tab's direct child; the Tabs controls which panel is shown.",
  Separator: "Horizontal hairline divider. Props: {}.",
};

export type WidgetActionName =
  | "notify"
  | "openUrl"
  | "sendPrompt"
  | "generateText"
  | "fetchUrl"
  | "setState"
  | "pushState"
  | "removeState"
  | "validateForm";

export const WIDGET_ACTION_NAMES: readonly WidgetActionName[] = [
  "notify",
  "openUrl",
  "sendPrompt",
  "generateText",
  "fetchUrl",
  "setState",
  "pushState",
  "removeState",
  "validateForm",
];

export const WIDGET_ACTION_DESCRIPTIONS: Record<WidgetActionName, string> = {
  notify: "Show a toast notification to the user.",
  openUrl: "Open an external HTTP(S) URL.",
  sendPrompt:
    "Send a message to the agent as a chat turn. The agent runs with all its tools and can revise this panel via manage_ui.",
  generateText:
    "Call the model once and write the resulting text into state at the JSON pointer `into`.",
  fetchUrl:
    "HTTP GET `url` and write the capped response body into state at the JSON pointer `into`.",
  setState: "Write a value into widget state.",
  pushState: "Append an item to an array in widget state.",
  removeState: "Remove an item from an array in widget state.",
  validateForm: "Validate registered form fields and write the result into widget state.",
};

export type WidgetActionRequest = {
  action: WidgetActionName;
  params?: Record<string, unknown>;
};

type WidgetRepeat = {
  statePath: string;
  key?: string;
};

type WidgetSpecInputElement = {
  type: JsonWidgetComponentType;
  props?: Record<string, unknown>;
  children?: string[];
  visible?: unknown;
  repeat?: WidgetRepeat;
  on?: Record<string, WidgetActionRequest | WidgetActionRequest[]>;
  watch?: Record<string, WidgetActionRequest | WidgetActionRequest[]>;
};

export type WidgetSpecInput = {
  root: string;
  elements: Record<string, WidgetSpecInputElement>;
  state?: Record<string, unknown>;
};

export type WidgetSpecElement = UIElement<JsonWidgetComponentType, Record<string, unknown>> & {
  type: JsonWidgetComponentType;
  props: Record<string, unknown>;
  children?: string[];
  visible?: VisibilityCondition;
  repeat?: WidgetRepeat;
  on?: Record<string, WidgetActionRequest | WidgetActionRequest[]>;
  watch?: Record<string, WidgetActionRequest | WidgetActionRequest[]>;
};

export type WidgetSpec = {
  root: string;
  elements: Record<string, WidgetSpecElement>;
  state?: Record<string, unknown>;
};

export function describeWidgetSpecLanguage(): string {
  return [
    "Generated widget spec:",
    "  { root: string, elements: Record<string, element>, state?: object }",
    "Element:",
    "  { type, props?, children?, visible?, repeat?, on?, watch? }",
    "Components:",
    ...JSON_WIDGET_COMPONENT_TYPES.map(
      (name) => `  - ${name}: ${WIDGET_COMPONENT_DESCRIPTIONS[name]}`,
    ),
    "Actions:",
    ...WIDGET_ACTION_NAMES.map((name) => `  - ${name}: ${WIDGET_ACTION_DESCRIPTIONS[name]}`),
  ].join("\n");
}
