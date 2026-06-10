// ---------------------------------------------------------------------------
// Generated widget spec language. TypeBox is the single source of truth here:
//   - TypeScript types are derived via Static<typeof ...>
//   - The agent tool's JSON Schema is the TypeBox object literal itself
//   - Boundary validation (IPC + agent calls) goes through parseWidgetSpec()
//     which checks the structural schema, validates every element's props
//     against its component's prop schema, and runs the structural-cycle pass
//   - The component vocabulary lives in ONE table (WIDGET_COMPONENTS): a
//     TypeBox prop schema plus agent-facing prose per component. The `Props:`
//     signatures in the prose are DERIVED from the schemas, and the renderer
//     catalog (renderer/shell/widget-catalog.ts) adapts the same schemas for
//     json-render — the prop contract is never hand-written twice.
// ---------------------------------------------------------------------------

import { type Static, type TObject, type TProperties, type TSchema, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { Spec } from "@json-render/core";

// ---------------------------------------------------------------------------
// Schema helpers
// ---------------------------------------------------------------------------

function literalUnion<const T extends readonly string[]>(values: T) {
  return Type.Union(values.map((value) => Type.Literal(value)));
}

// Props that display or bind data routinely carry a dynamic-value object —
// e.g. `{ $bindState: "/temp" }` — instead of a literal. json-render resolves
// these at render time, so the runtime schema must accept the literal AND any
// documented dynamic expression object, while the *static* type stays the
// resolved primitive (what the component implementation actually receives).
const DYNAMIC_VALUE_KEYS = [
  "$state",
  "$bindState",
  "$template",
  "$item",
  "$bindItem",
  "$index",
  "$cond",
  "$computed",
] as const;

// "An object carrying at least one documented dynamic-value key."
const DynamicValueParam = Type.Union(
  DYNAMIC_VALUE_KEYS.map((key) => Type.Object({ [key]: Type.Unknown() })),
);

// Marker so the signature printer and the error formatter can recognize a
// dynamic wrapper and describe it as its base type.
const DYNAMIC_OPTION = "x-dynamic";

function Dynamic<T extends TSchema>(base: T) {
  return Type.Unsafe<Static<T>>(Type.Union([base, DynamicValueParam], { [DYNAMIC_OPTION]: true }));
}

const DynString = Dynamic(Type.String());
const DynNumber = Dynamic(Type.Number());
const DynBoolean = Dynamic(Type.Boolean());

/** Strict props object — unknown keys are rejected. Props are not a place for
 * layout or styling overrides (no className/style). */
function propsObject<T extends TProperties>(properties: T) {
  return Type.Object(properties, { additionalProperties: false });
}

// Enum props are spelled as explicit literal tuples (not via literalUnion):
// calling .map on a generic readonly-string[] receiver resolves the callback
// param through the constraint, so literalUnion's Static widens to `string`.
// These statics feed WidgetComponentProps, which defineRegistry uses to
// compile-check the component implementations — they must stay precise.
const GapParam = Type.Union([Type.Literal("sm"), Type.Literal("md"), Type.Literal("lg")]);
const TextSizeParam = Type.Union([Type.Literal("xs"), Type.Literal("sm"), Type.Literal("base")]);
const HeadingLevelParam = Type.Union([Type.Literal("1"), Type.Literal("2"), Type.Literal("3")]);
const ButtonVariantParam = Type.Union([
  Type.Literal("default"),
  Type.Literal("outline"),
  Type.Literal("ghost"),
  Type.Literal("secondary"),
  Type.Literal("destructive"),
]);
const ButtonSizeParam = Type.Union([
  Type.Literal("xs"),
  Type.Literal("sm"),
  Type.Literal("default"),
  Type.Literal("lg"),
]);
const BadgeVariantParam = Type.Union([
  Type.Literal("default"),
  Type.Literal("secondary"),
  Type.Literal("destructive"),
  Type.Literal("outline"),
  Type.Literal("ghost"),
]);
const ControlSizeParam = Type.Union([
  Type.Literal("sm"),
  Type.Literal("default"),
  Type.Literal("lg"),
]);
const AccentColorParam = Type.Union([
  Type.Literal("yellow"),
  Type.Literal("blue"),
  Type.Literal("purple"),
  Type.Literal("green"),
  Type.Literal("orange"),
  Type.Literal("red"),
]);
const ChartTypeParam = Type.Union([
  Type.Literal("line"),
  Type.Literal("bar"),
  Type.Literal("area"),
  Type.Literal("pie"),
]);
const DrawerSideParam = Type.Union([
  Type.Literal("top"),
  Type.Literal("bottom"),
  Type.Literal("left"),
  Type.Literal("right"),
]);
const MenuItemVariantParam = Type.Union([Type.Literal("default"), Type.Literal("destructive")]);

const OptionItemParam = propsObject({ label: Type.String(), value: Type.String() });
const RadioOptionItemParam = propsObject({
  label: Type.String(),
  value: Type.String(),
  description: Type.Optional(Type.String()),
});
const ChartSeriesParam = propsObject({
  key: Type.String(),
  label: Type.Optional(Type.String()),
  color: Type.Optional(Type.String()),
});

const textFieldProps = {
  label: Type.Optional(DynString),
  placeholder: Type.Optional(DynString),
  value: Type.Optional(DynString),
  disabled: Type.Optional(DynBoolean),
};

// ---------------------------------------------------------------------------
// Component vocabulary — the single source of truth
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
  "Accent",
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

type WidgetComponentEntry = {
  /** Runtime prop contract. Enforced at the write boundary (parseWidgetSpec,
   * so manage_ui install/update/patch fail into the tool result) and re-run
   * by the renderer as defense-in-depth. */
  props: TObject;
  /** Agent-facing one-liner. The `Props:` signature shown to the agent is
   * derived from `props`, so prose and schema cannot drift. */
  summary: string;
  /** Usage guidance appended after the derived `Props:` signature. */
  note?: string;
};

// `satisfies` keeps each entry's precise TObject type (for per-component
// Static prop types) while enforcing exhaustiveness against the type union —
// adding a component without a schema or prose is a compile error.
const WIDGET_COMPONENTS = {
  Stack: {
    props: propsObject({ gap: Type.Optional(GapParam) }),
    summary: "Vertical stack container.",
    note: "Use as the top-level wrapper or nested groups.",
  },
  Section: {
    props: propsObject({ title: Type.Optional(DynString) }),
    summary: "Labeled group of rows.",
    note: "Renders a small uppercase title when set.",
  },
  Row: {
    props: propsObject({ bordered: Type.Optional(Type.Boolean()) }),
    summary: "Horizontal row with space-between layout.",
    note: "Bordered by default.",
  },
  Grid: {
    props: propsObject({ columns: Type.Optional(Type.Number()), gap: Type.Optional(GapParam) }),
    summary: "Multi-column grid container.",
    note: "Lays children out in equal columns; columns defaults to 2.",
  },
  Heading: {
    props: propsObject({ text: DynString, level: Type.Optional(HeadingLevelParam) }),
    summary: "Heading text.",
    note: "Defaults to level 3.",
  },
  Text: {
    props: propsObject({
      text: DynString,
      muted: Type.Optional(Type.Boolean()),
      size: Type.Optional(TextSizeParam),
    }),
    summary: "Text node.",
  },
  TextBlock: {
    props: propsObject({ title: DynString, description: Type.Optional(DynString) }),
    summary: "Two-line text.",
    note: "Use for label/value summaries.",
  },
  Markdown: {
    props: propsObject({ content: Type.Optional(DynString) }),
    summary: "Rendered markdown block.",
    note: "Bind `content` via { $bindState: '/path' } to show generated/fetched text.",
  },
  Badge: {
    props: propsObject({ text: DynString, variant: Type.Optional(BadgeVariantParam) }),
    summary: "Inline status badge.",
  },
  Button: {
    props: propsObject({
      label: DynString,
      variant: Type.Optional(ButtonVariantParam),
      size: Type.Optional(ButtonSizeParam),
      disabled: Type.Optional(DynBoolean),
    }),
    summary: "Clickable button.",
    note: "Wire `on.press` to actions.",
  },
  Checkbox: {
    props: propsObject({
      label: DynString,
      description: Type.Optional(DynString),
      checked: Type.Optional(DynBoolean),
      disabled: Type.Optional(DynBoolean),
    }),
    summary: "Checkbox.",
    note: "Two-way bind `checked` via { $bindState: '/path' }.",
  },
  Switch: {
    props: propsObject({
      label: DynString,
      description: Type.Optional(DynString),
      checked: Type.Optional(DynBoolean),
      disabled: Type.Optional(DynBoolean),
    }),
    summary: "Toggle switch.",
    note: "Two-way bind `checked` via { $bindState: '/path' }.",
  },
  Input: {
    props: propsObject(textFieldProps),
    summary: "Text input.",
    note: "Two-way bind `value` via { $bindState: '/path' }.",
  },
  Textarea: {
    props: propsObject({ ...textFieldProps, rows: Type.Optional(Type.Number()) }),
    summary: "Multi-line input.",
    note: "Two-way bind `value`.",
  },
  Select: {
    props: propsObject({
      label: Type.Optional(DynString),
      placeholder: Type.Optional(DynString),
      value: Type.Optional(DynString),
      options: Type.Array(OptionItemParam),
      disabled: Type.Optional(DynBoolean),
    }),
    summary: "Dropdown select.",
    note: "Two-way bind `value`.",
  },
  RadioGroup: {
    props: propsObject({
      label: Type.Optional(DynString),
      value: Type.Optional(DynString),
      options: Type.Array(RadioOptionItemParam),
      disabled: Type.Optional(DynBoolean),
    }),
    summary: "Single-choice radio group.",
    note: "Two-way bind `value`.",
  },
  Slider: {
    props: propsObject({
      label: Type.Optional(DynString),
      value: Type.Optional(DynNumber),
      min: Type.Optional(Type.Number()),
      max: Type.Optional(Type.Number()),
      step: Type.Optional(Type.Number()),
      disabled: Type.Optional(DynBoolean),
    }),
    summary: "Numeric slider.",
    note: "Two-way bind `value` (number).",
  },
  Avatar: {
    props: propsObject({
      src: Type.Optional(DynString),
      fallback: Type.Optional(DynString),
      size: Type.Optional(ControlSizeParam),
    }),
    summary: "User avatar.",
    note: "Shows `fallback` initials when no image.",
  },
  Spinner: {
    props: propsObject({ size: Type.Optional(ControlSizeParam) }),
    summary: "Loading spinner.",
    note: "Pair with generateText/fetchUrl and a `visible` condition.",
  },
  Image: {
    props: propsObject({
      src: DynString,
      alt: Type.Optional(DynString),
      rounded: Type.Optional(Type.Boolean()),
    }),
    summary: "Image.",
    note: "Square by default; set rounded: true for rounded corners.",
  },
  Chart: {
    props: propsObject({
      type: Type.Optional(ChartTypeParam),
      data: Type.Optional(Dynamic(Type.Array(Type.Record(Type.String(), Type.Unknown())))),
      series: Type.Array(ChartSeriesParam),
      categoryKey: Type.Optional(Type.String()),
      height: Type.Optional(Type.Number()),
      stacked: Type.Optional(Type.Boolean()),
      showLegend: Type.Optional(Type.Boolean()),
      showGrid: Type.Optional(Type.Boolean()),
    }),
    summary: "Chart (Recharts).",
    note:
      "Defaults: type 'bar', categoryKey 'name' (x-axis / slice-name field), height 220. " +
      "Bind `data` to a state array via { $bindState: '/path' } (e.g. from fetchUrl); each " +
      "series plots one numeric field. For pie, the first series is the value field and " +
      "slices come from `categoryKey`.",
  },
  Card: {
    props: propsObject({}),
    summary: "Bordered container.",
    note: "Use to group arbitrary children.",
  },
  Accent: {
    props: propsObject({ color: AccentColorParam }),
    summary: "Colored left-stripe container.",
    note:
      "Renders a 3px vertical bar in the chosen color with the children stacked to its " +
      "right. Use for timeline rows or meeting prep where a small color tag identifies a " +
      "category.",
  },
  Collapsible: {
    props: propsObject({ title: DynString, defaultOpen: Type.Optional(Type.Boolean()) }),
    summary: "Collapsible disclosure.",
    note: "Children show when expanded.",
  },
  Tabs: {
    props: propsObject({ tabs: Type.Array(OptionItemParam) }),
    summary: "Tabbed container.",
    note:
      "Provide exactly one child per tab — child N is the panel for tab N, paired by " +
      "position. Don't put a `visible` condition on a tab's direct child; the Tabs " +
      "controls which panel is shown.",
  },
  Table: {
    props: propsObject({ caption: Type.Optional(DynString) }),
    summary: "Data table.",
    note: "Children are a TableHeader and/or a TableBody section.",
  },
  TableHeader: {
    props: propsObject({}),
    summary: "Table header section (thead).",
    note: "Children are TableRow elements containing TableHead cells.",
  },
  TableBody: {
    props: propsObject({}),
    summary: "Table body section (tbody).",
    note: "Children are TableRow elements. Add `repeat: { statePath, key }` on a row to render one per item.",
  },
  TableRow: {
    props: propsObject({}),
    summary: "Table row.",
    note:
      "Children are TableHead cells (in a TableHeader) or TableCell cells (in a TableBody). " +
      "On a body row, add `repeat: { statePath, key }` and bind cell text with " +
      "{ $item: 'field' } for a data-driven table.",
  },
  TableHead: {
    props: propsObject({ text: DynString }),
    summary: "Table header cell.",
  },
  TableCell: {
    props: propsObject({ text: Type.Optional(DynString) }),
    summary: "Table body cell.",
    note: "Set `text`, or omit it and add children (e.g. a Badge or Button) for a rich cell.",
  },
  Dialog: {
    props: propsObject({
      trigger: DynString,
      title: Type.Optional(DynString),
      description: Type.Optional(DynString),
    }),
    summary: "Modal dialog.",
    note:
      "`trigger` renders a button; children are the dialog body. Closes via the ✕, Escape, " +
      "or an outside click.",
  },
  Drawer: {
    props: propsObject({
      trigger: DynString,
      title: Type.Optional(DynString),
      description: Type.Optional(DynString),
      side: Type.Optional(DrawerSideParam),
    }),
    summary: "Slide-out drawer.",
    note: "`trigger` renders a button; children are the drawer body. `side` defaults to 'right'.",
  },
  Popover: {
    props: propsObject({ trigger: DynString }),
    summary: "Popover anchored to a trigger button.",
    note: "Children are the popover content.",
  },
  Tooltip: {
    props: propsObject({ text: DynString }),
    summary: "Hover tooltip.",
    note: "Wraps its single child as the hover target.",
  },
  DropdownMenu: {
    props: propsObject({ trigger: DynString }),
    summary: "Dropdown menu.",
    note: "Children are MenuItem elements.",
  },
  MenuItem: {
    props: propsObject({
      label: DynString,
      variant: Type.Optional(MenuItemVariantParam),
      disabled: Type.Optional(DynBoolean),
    }),
    summary: "Dropdown menu item (use inside DropdownMenu).",
    note: "Wire `on.press` to actions.",
  },
  Separator: {
    props: propsObject({}),
    summary: "Horizontal hairline divider.",
  },
} satisfies Record<JsonWidgetComponentType, WidgetComponentEntry>;

/** Static props type for one component, derived from its TypeBox schema.
 * Dynamic-capable props type as the resolved primitive (string/number/...),
 * matching what json-render hands the implementation after resolution. */
export type WidgetComponentProps<K extends JsonWidgetComponentType> = Static<
  (typeof WIDGET_COMPONENTS)[K]["props"]
>;

export function componentPropsSchema(type: JsonWidgetComponentType): TObject {
  return WIDGET_COMPONENTS[type].props;
}

/** Compact TS-ish signature derived from the component's prop schema, e.g.
 * `{ gap?: 'sm'|'md'|'lg' }`. This is the only prop list the agent ever
 * sees — it cannot drift from the validated contract. */
export function componentPropsSignature(type: JsonWidgetComponentType): string {
  return printPropType(WIDGET_COMPONENTS[type].props);
}

/** Agent-facing description: summary + derived `Props:` signature + note. */
export function componentDescription(type: JsonWidgetComponentType): string {
  // Widen through the entry type — not every table entry declares `note`.
  const entry: WidgetComponentEntry = WIDGET_COMPONENTS[type];
  const suffix = entry.note === undefined ? "" : ` ${entry.note}`;
  return `${entry.summary} Props: ${componentPropsSignature(type)}.${suffix}`;
}

function printPropType(schema: unknown): string {
  if (!isRecord(schema)) return "unknown";
  const anyOf = schema["anyOf"];
  if (Array.isArray(anyOf)) {
    // Dynamic wrapper: describe as the base (resolved) type.
    if (schema[DYNAMIC_OPTION] === true) return printPropType(anyOf[0]);
    return anyOf.map(printPropType).join("|");
  }
  if ("const" in schema) {
    const value = schema["const"];
    return typeof value === "string" ? `'${value}'` : String(value);
  }
  switch (schema["type"]) {
    case "string":
      return "string";
    case "number":
    case "integer":
      return "number";
    case "boolean":
      return "boolean";
    case "array":
      return `${printPropType(schema["items"])}[]`;
    case "object": {
      // Type.Record (open map) — print as plain object.
      if (isRecord(schema["patternProperties"])) return "object";
      const properties = isRecord(schema["properties"]) ? schema["properties"] : {};
      const required = Array.isArray(schema["required"]) ? schema["required"] : [];
      const entries = Object.entries(properties).map(
        ([name, prop]) => `${name}${required.includes(name) ? "" : "?"}: ${printPropType(prop)}`,
      );
      return entries.length === 0 ? "{}" : `{ ${entries.join(", ")} }`;
    }
    default:
      return "unknown";
  }
}

// ---------------------------------------------------------------------------
// Action vocabulary
// ---------------------------------------------------------------------------

const WIDGET_ACTION_NAMES = [
  "notify",
  "openUrl",
  "sendPrompt",
  "generateText",
  "fetchUrl",
  "fetchJson",
  "callTool",
  "setNow",
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
  fetchJson:
    "HTTP GET a JSON `url` and route fields into state. `paths` maps a destination JSON pointer (in widget state) to a source JSON pointer (into the response body). E.g. paths: { '/temp': '/current/temperature_2m' } writes the response's /current/temperature_2m to state /temp. Optional `error` JSON pointer receives the error message on failure (otherwise a toast is shown).",
  setNow:
    "Write the current date/time into state. `paths` maps a destination JSON pointer to one of: 'dayShort' (e.g. 'Wed'), 'dayLong' ('Wednesday'), 'dayNum' ('03'), 'monthShort' ('Jun'), 'monthLong' ('June'), 'year' ('2026'), 'iso' (full ISO timestamp), 'hourMinute12' ('2:30 PM'). Local time zone.",
  callTool:
    "Invoke a configured integration tool (MCP / API source) by its dotted path `tool` (e.g. 'github.search_issues') with the `input` object, and write the returned data into state at the JSON pointer `into`. Pulls live data without an agent turn — bind a Table/Chart/Markdown to `into` to display it. Optional `select` JSON pointer extracts a sub-path of the response before writing (e.g. select='/items' for an envelope-wrapped list). Optional `error` JSON pointer receives the error message on failure (otherwise a toast is shown). Input values can use `{ $state: '/path' }` to embed live state (e.g. timeMin for an events list).",
  setState: "Write a value into widget state.",
  pushState: "Append an item to an array in widget state.",
  removeState: "Remove an item from an array in widget state.",
  validateForm: "Validate registered form fields and write the result into widget state.",
};

// ---------------------------------------------------------------------------
// TypeBox structural schemas — the agent tool's JSON Schema, IPC payload
// validation, and TypeScript types.
// ---------------------------------------------------------------------------

const ComponentTypeParam = literalUnion(JSON_WIDGET_COMPONENT_TYPES);
const ActionNameParam = literalUnion(WIDGET_ACTION_NAMES);

const ActionRequestParam = Type.Object(
  {
    action: ActionNameParam,
    params: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    // Optional JSON pointer. If the value at this state path is "non-empty"
    // (not null/undefined/empty-string/empty-array/empty-object), the runtime
    // skips this action. Primary use: onMount data loaders that should cache
    // across restarts. Empty pointer ("") references the whole state object.
    skipIf: Type.Optional(Type.String()),
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
// fills in {} during canonicalization. Props stay an open record at this
// level so the tool's JSON Schema stays flat and OpenAI-friendly; the
// per-component contract is enforced by parseWidgetSpec's props walk.
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
    // Actions to fire once on first render, in order. Use for live data
    // loaders (setNow, fetchJson, callTool, generateText) so the widget
    // populates without a user click.
    onMount: Type.Optional(Type.Array(ActionRequestParam)),
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
  // oxlint-disable-next-line typescript/consistent-type-assertions -- json-render Spec bridge, see doc above
  return spec as unknown as Spec;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type ParseWidgetSpecOptions = {
  /**
   * Skip the per-component prop validation. ONLY for the trusted read/decode
   * path (ShellManager's store decode): a legacy def written before props
   * were validated at the write boundary must not brick the whole store via
   * JsonStore's corrupt-recovery. The renderer's validateWidgetProps still
   * flags it at render time, and the next update/patch must fix it.
   */
  skipComponentProps?: boolean;
};

/**
 * Parse + validate a widget spec. Accepts inputs that omit the per-element
 * `props` object (the model often does so for prop-less components like
 * Stack/Card/Separator) and canonicalizes them to `{}`. Throws on TypeBox
 * mismatch, on invalid component props, or on a child cycle — write callers
 * (manage_ui install/update/patch, IPC) surface the message to the agent so
 * it can self-correct in the same turn.
 */
export function parseWidgetSpec(input: unknown, options: ParseWidgetSpecOptions = {}): WidgetSpec {
  const canonical = canonicalizeProps(input);
  if (!Value.Check(WidgetSpecParam, canonical)) {
    const first = Value.Errors(WidgetSpecParam, canonical).First();
    const detail = first ? `${first.path}: ${first.message}` : "shape mismatch";
    throw new Error(`Invalid widget spec — ${detail}`);
  }
  if (options.skipComponentProps !== true) {
    const validation = validateWidgetProps(canonical);
    if (!validation.success) throw new Error(formatWidgetPropsError(validation.issues));
  }
  validateStructure(canonical);
  return canonical;
}

type WidgetPropsIssue = {
  elementKey: string;
  component: string;
  /** Dot path into the element's props; "<root>" for the props object itself. */
  path: string;
  message: string;
};

export type WidgetPropsValidation =
  | { success: true; issues: [] }
  | { success: false; issues: WidgetPropsIssue[] };

// String-keyed view of the component table for walking specs whose element
// types are not statically narrowed (renderer defense-in-depth on IPC data).
const COMPONENT_PROP_SCHEMAS: ReadonlyMap<string, TObject> = new Map(
  JSON_WIDGET_COMPONENT_TYPES.map((type) => [type, WIDGET_COMPONENTS[type].props]),
);

/**
 * Validate every element's props against its component's shared TypeBox
 * schema. Runs inside parseWidgetSpec (the write boundary) and again in the
 * renderer before mounting a viewer (defense-in-depth for legacy defs that
 * predate write-boundary validation).
 */
export function validateWidgetProps(spec: {
  elements: Record<string, { type: string; props?: Record<string, unknown> }>;
}): WidgetPropsValidation {
  const issues: WidgetPropsIssue[] = [];
  for (const [elementKey, element] of Object.entries(spec.elements)) {
    const schema = COMPONENT_PROP_SCHEMAS.get(element.type);
    if (!schema) {
      issues.push({
        elementKey,
        component: element.type,
        path: "<root>",
        message: `Unknown component type '${element.type}'`,
      });
      continue;
    }
    const props = element.props ?? {};
    if (Value.Check(schema, props)) continue;
    // One issue per prop path. TypeBox reports a missing required prop twice
    // (required + type mismatch) — the first message is the useful one.
    const seen = new Set<string>();
    for (const error of Value.Errors(schema, props)) {
      if (seen.has(error.path)) continue;
      seen.add(error.path);
      issues.push({
        elementKey,
        component: element.type,
        path: error.path === "" ? "<root>" : error.path.slice(1).replaceAll("/", "."),
        message: describePropError(error.schema, error.message),
      });
    }
  }
  return issues.length === 0 ? { success: true, issues: [] } : { success: false, issues };
}

/** Rewrite TypeBox's generic "Expected union value" into something the agent
 * can act on: the resolved base type for dynamic wrappers, the literal list
 * for enums. */
function describePropError(schema: unknown, message: string): string {
  if (!message.startsWith("Expected union")) return message;
  if (isRecord(schema)) {
    if (schema[DYNAMIC_OPTION] === true) {
      return `Expected ${printPropType(schema)} or a dynamic-value object (e.g. { $bindState: '/path' })`;
    }
    const anyOf = schema["anyOf"];
    if (Array.isArray(anyOf) && anyOf.every((v) => isRecord(v) && "const" in v)) {
      return `Expected one of ${anyOf.map(printPropType).join(" | ")}`;
    }
  }
  return message;
}

const MAX_PROP_ISSUES = 8;

function formatWidgetPropsError(issues: WidgetPropsIssue[]): string {
  const shown = issues.slice(0, MAX_PROP_ISSUES);
  const lines = shown.map(
    (i) =>
      `  - element '${i.elementKey}' (${i.component}) props${i.path === "<root>" ? "" : `.${i.path}`}: ${i.message}`,
  );
  const more = issues.length - shown.length;
  if (more > 0) lines.push(`  - … and ${more} more`);
  const involved = new Set<string>(shown.map((i) => i.component));
  const contracts = JSON_WIDGET_COMPONENT_TYPES.filter((t) => involved.has(t)).map(
    (t) => `  - ${t}: ${componentPropsSignature(t)}`,
  );
  return [
    "Invalid widget spec — component props failed validation:",
    ...lines,
    ...(contracts.length > 0 ? ["Expected prop contracts:", ...contracts] : []),
  ].join("\n");
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
      // Fill the four "optional-but-the-framework-spec-schema-requires-them-
      // to-be-present" fields. Our TypeBox schema marks props/children/visible
      // as optional, but json-render's auto-generated spec schema (built from
      // its React schema declarations) declares them as required `any`/array,
      // so a leaf element written as `{ type: 'Text', props: {...} }` would
      // fail catalog.validate() with "expected nonopt" at render time. We
      // normalize the missing slots at parse time so the on-disk shape is
      // stable and the renderer's validation gate stays useful.
      const merged: Record<string, unknown> = { ...raw };
      if (merged["props"] === undefined) merged["props"] = {};
      if (merged["children"] === undefined) merged["children"] = [];
      // `true` (always visible), not `null` — json-render evaluates `visible`
      // through resolvePropValue, which checks `key in value` for `$cond` /
      // `$index` / etc. on the visibility object; `'$index' in null` throws.
      if (merged["visible"] === undefined) merged["visible"] = true;
      next[id] = merged;
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
    "  { root: string, elements: Record<string, element>, state?: object, onMount?: Action[] }",
    "",
    "onMount fires its actions once when the widget first renders — use this",
    "for live data loaders (setNow / fetchJson / callTool / generateText) so the",
    "widget populates without a user click. Add `skipIf: <state JSON pointer>` to",
    "an action to skip it when that path is already populated (cached value",
    "across restarts).",
    "",
    "Element:",
    "  { type, props?, children?, visible?, repeat?, on?, watch? }",
    "    type     — component name from the Components list below",
    "    props    — ONLY the prop keys the component documents (in its Props: schema).",
    "               Unknown keys are rejected; props are NOT a place for layout or",
    "               styling overrides (no className/style).",
    "    children — array of OTHER ELEMENT KEYS from this elements map.",
    "               NOT a string, NOT React-style children, NOT a single key. Always an",
    "               array of strings, each one a sibling element id you also declared.",
    "               To put text inside a Card, declare a Text element and list its key here.",
    "",
    "Common mistakes to avoid:",
    "  - Card with { props: { children: 'hello' } } — Card has no `children` prop. Make a",
    "    Text element with { type: 'Text', props: { text: 'hello' } } and put its KEY in",
    "    the Card's `children: ['textKey']`.",
    "  - Setting className/style/wrapper props that aren't in the component's Props: doc.",
    "  - children as a string instead of an array of element keys.",
    "",
    "Components:",
    ...JSON_WIDGET_COMPONENT_TYPES.map((name) => `  - ${name}: ${componentDescription(name)}`),
    "Actions:",
    ...WIDGET_ACTION_NAMES.map((name) => `  - ${name}: ${WIDGET_ACTION_DESCRIPTIONS[name]}`),
  ].join("\n");
}
