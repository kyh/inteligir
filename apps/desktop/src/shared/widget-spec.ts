// ---------------------------------------------------------------------------
// Generated widget spec language. TypeBox is the single source of truth here:
//   - TypeScript types are derived via Static<typeof ...>
//   - The agent tool's JSON Schema is the TypeBox object literal itself
//   - Boundary validation (IPC + agent calls) goes through parseWidgetSpec()
//     which checks against the TypeBox schema + runs the structural-cycle pass
// ---------------------------------------------------------------------------

import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { Spec } from "@json-render/core";

// ---------------------------------------------------------------------------
// Component vocabulary
// ---------------------------------------------------------------------------

const JSON_WIDGET_COMPONENT_TYPES = [
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
  "Chart",
  "Card",
  "Collapsible",
  "Tabs",
  "Table",
  "TableHeader",
  "TableBody",
  "TableRow",
  "TableHead",
  "TableCell",
  "Dialog",
  "Drawer",
  "Popover",
  "Tooltip",
  "DropdownMenu",
  "MenuItem",
  "Separator",
] as const;

export type JsonWidgetComponentType = (typeof JSON_WIDGET_COMPONENT_TYPES)[number];

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
    "Rendered markdown block. Props: { content?: string }. Bind `content` via { $bindState: '/path' } to show generated/fetched text.",
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
  Chart:
    "Chart (Recharts). Props: { type?: 'line'|'bar'|'area'|'pie' (default 'bar'), data?: object[], series: { key: string, label?: string, color?: string }[], categoryKey?: string (x-axis / slice-name field, default 'name'), height?: number (default 220), stacked?: boolean, showLegend?: boolean, showGrid?: boolean }. Bind `data` to a state array via { $bindState: '/path' } (e.g. from fetchUrl); each series plots one numeric field. For pie, the first series is the value field and slices come from `categoryKey`.",
  Card: "Bordered container. Props: {}. Use to group arbitrary children.",
  Collapsible:
    "Collapsible disclosure. Props: { title: string, defaultOpen?: boolean }. Children show when expanded.",
  Tabs: "Tabbed container. Props: { tabs: { label: string, value: string }[] }. Provide exactly one child per tab — child N is the panel for tab N, paired by position. Don't put a `visible` condition on a tab's direct child; the Tabs controls which panel is shown.",
  Table:
    "Data table. Props: { caption?: string }. Children are a TableHeader and/or a TableBody section.",
  TableHeader:
    "Table header section (thead). Props: {}. Children are TableRow elements containing TableHead cells.",
  TableBody:
    "Table body section (tbody). Props: {}. Children are TableRow elements. Add `repeat: { statePath, key }` on a row to render one per item.",
  TableRow:
    "Table row. Props: {}. Children are TableHead cells (in a TableHeader) or TableCell cells (in a TableBody). On a body row, add `repeat: { statePath, key }` and bind cell text with { $item: 'field' } for a data-driven table.",
  TableHead: "Table header cell. Props: { text: string }.",
  TableCell:
    "Table body cell. Props: { text?: string }. Set `text`, or omit it and add children (e.g. a Badge or Button) for a rich cell.",
  Dialog:
    "Modal dialog. Props: { trigger: string, title?: string, description?: string }. `trigger` renders a button; children are the dialog body. Closes via the ✕, Escape, or an outside click.",
  Drawer:
    "Slide-out drawer. Props: { trigger: string, title?: string, description?: string, side?: 'top'|'bottom'|'left'|'right' (default 'right') }. `trigger` renders a button; children are the drawer body.",
  Popover:
    "Popover anchored to a trigger button. Props: { trigger: string }. Children are the popover content.",
  Tooltip: "Hover tooltip. Props: { text: string }. Wraps its single child as the hover target.",
  DropdownMenu:
    "Dropdown menu. Props: { trigger: string }. Children are MenuItem elements.",
  MenuItem:
    "Dropdown menu item (use inside DropdownMenu). Props: { label: string, variant?: 'default'|'destructive', disabled?: boolean }. Wire `on.press` to actions.",
  Separator: "Horizontal hairline divider. Props: {}.",
};

// ---------------------------------------------------------------------------
// Action vocabulary
// ---------------------------------------------------------------------------

const WIDGET_ACTION_NAMES = [
  "notify",
  "openUrl",
  "sendPrompt",
  "generateText",
  "fetchUrl",
  "callTool",
  "setState",
  "pushState",
  "removeState",
  "validateForm",
] as const;

export type WidgetActionName = (typeof WIDGET_ACTION_NAMES)[number];

export const WIDGET_ACTION_DESCRIPTIONS: Record<WidgetActionName, string> = {
  notify: "Show a toast notification to the user.",
  openUrl: "Open an external HTTP(S) URL.",
  sendPrompt:
    "Send a message to the agent as a chat turn. The agent runs with all its tools and can revise this panel via manage_ui.",
  generateText:
    "Call the model once and write the resulting text into state at the JSON pointer `into`.",
  fetchUrl:
    "HTTP GET `url` and write the capped response body into state at the JSON pointer `into`.",
  callTool:
    "Invoke a configured integration tool (MCP / API source) by its dotted path `tool` (e.g. 'github.search_issues') with the `input` object, and write the returned data into state at the JSON pointer `into`. Pulls live data without an agent turn — bind a Table/Chart/Markdown to `into` to display it. Optional `error` JSON pointer receives the error message on failure (otherwise a toast is shown).",
  setState: "Write a value into widget state.",
  pushState: "Append an item to an array in widget state.",
  removeState: "Remove an item from an array in widget state.",
  validateForm: "Validate registered form fields and write the result into widget state.",
};

// ---------------------------------------------------------------------------
// TypeBox schemas — the single source of truth for the agent tool's JSON
// Schema, IPC payload validation, and TypeScript types.
// ---------------------------------------------------------------------------

function literalUnion<const T extends readonly string[]>(values: T) {
  return Type.Union(values.map((value) => Type.Literal(value)));
}

const ComponentTypeParam = literalUnion(JSON_WIDGET_COMPONENT_TYPES);
const ActionNameParam = literalUnion(WIDGET_ACTION_NAMES);

const ActionRequestParam = Type.Object(
  {
    action: ActionNameParam,
    params: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: false },
);

const ActionBindingParam = Type.Union([ActionRequestParam, Type.Array(ActionRequestParam)]);

const RepeatParam = Type.Object(
  {
    statePath: Type.String(),
    key: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

// Element shape exposed in the agent tool's JSON Schema. `props` is required
// here so the generated TypeScript type matches json-render's UIElement (which
// requires `props`), but parseWidgetSpec accepts inputs that omit props and
// fills in {} during canonicalization.
const ElementParam = Type.Object(
  {
    type: ComponentTypeParam,
    props: Type.Record(Type.String(), Type.Unknown()),
    children: Type.Optional(Type.Array(Type.String())),
    // The visibility condition's structural validation lives in @json-render/core
    // and runs at render time; the spec language only commits to "some value".
    visible: Type.Optional(Type.Unknown()),
    repeat: Type.Optional(RepeatParam),
    on: Type.Optional(Type.Record(Type.String(), ActionBindingParam)),
    watch: Type.Optional(Type.Record(Type.String(), ActionBindingParam)),
  },
  { additionalProperties: false },
);

export const WidgetSpecParam = Type.Object(
  {
    root: Type.String({ description: "Key of the root element in elements" }),
    elements: Type.Record(Type.String(), ElementParam),
    state: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: false },
);

// ---------------------------------------------------------------------------
// Inferred TypeScript types — derived from TypeBox so the schema, types, and
// const arrays cannot drift.
// ---------------------------------------------------------------------------

export type WidgetSpec = Static<typeof WidgetSpecParam>;

/**
 * Bridge our TypeBox-narrowed WidgetSpec to @json-render/core's wider Spec
 * (looser action-binding shape, looser visibility). Runtime-safe: every
 * WidgetSpec already satisfies the json-render runtime contract, but the
 * type systems are structurally different at the binding-value level.
 * Centralizing the conversion here means the rest of the renderer can type
 * Spec naturally without per-call-site casts.
 */
export function toRendererSpec(spec: WidgetSpec): Spec {
  return spec as unknown as Spec;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Parse + structurally validate a widget spec. Accepts inputs that omit the
 * per-element `props` object (the model often does so for prop-less components
 * like Stack/Card/Separator) and canonicalizes them to `{}`. Throws on TypeBox
 * mismatch or on a child cycle.
 */
export function parseWidgetSpec(input: unknown): WidgetSpec {
  const canonical = canonicalizeProps(input);
  if (!Value.Check(WidgetSpecParam, canonical)) {
    const first = Value.Errors(WidgetSpecParam, canonical).First();
    const detail = first ? `${first.path}: ${first.message}` : "shape mismatch";
    throw new Error(`Invalid widget spec — ${detail}`);
  }
  validateStructure(canonical);
  return canonical;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function canonicalizeProps(input: unknown): unknown {
  if (!isRecord(input)) return input;
  const elements = input["elements"];
  if (!isRecord(elements)) return input;
  const next: Record<string, unknown> = {};
  for (const [id, raw] of Object.entries(elements)) {
    if (isRecord(raw)) {
      next[id] = raw["props"] === undefined ? { ...raw, props: {} } : raw;
    } else {
      next[id] = raw;
    }
  }
  return { ...input, elements: next };
}

function validateStructure(spec: WidgetSpec): void {
  if (!spec.elements[spec.root]) {
    throw new Error(`Widget spec root '${spec.root}' does not exist`);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`Widget spec has a child cycle at '${id}'`);
    const element = spec.elements[id];
    if (!element) throw new Error(`Widget spec references missing child '${id}'`);
    visiting.add(id);
    for (const child of element.children ?? []) visit(child);
    visiting.delete(id);
    visited.add(id);
  };
  visit(spec.root);
}

// ---------------------------------------------------------------------------
// Agent prompt
// ---------------------------------------------------------------------------

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
