// json-render catalog for agent-authored widget panels.
//
// Components map onto @repo/ui primitives so generated widgets match the app.
// Generated widgets are trusted; live actions run through main-process guards.

import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { z } from "zod";

import { WIDGET_ACTION_DESCRIPTIONS, WIDGET_COMPONENT_DESCRIPTIONS } from "@/shared/widget-spec";

// Props that display data (text, label, content, src, …) routinely carry a
// dynamic-value object — e.g. `{ $bindState: "/temp" }` — instead of a literal.
// json-render resolves these at render time; strict z.string() would reject
// them and surface as a "spec is invalid" error inside the viewer. dynamicString
// accepts the literal AND the documented dynamic expression objects, so the
// per-component schemas can stay otherwise strict (catching the original empty-
// Card / unknown-prop class of bugs) without breaking live data binding.
const DYNAMIC_KEYS = [
  "$state",
  "$bindState",
  "$template",
  "$item",
  "$bindItem",
  "$index",
  "$cond",
  "$computed",
] as const;

function isDynamicValue(v: unknown): boolean {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const record = v as Record<string, unknown>;
  return DYNAMIC_KEYS.some((key) => key in record);
}

// The component receives a resolved primitive — json-render evaluates the
// dynamic-value object before mounting. So at compile time we declare the
// component's prop as the primitive; at runtime, our `validateWidgetProps`
// walker (see bottom of this file) calls each component's `.props.safeParse`
// directly, and these schemas accept the literal AND any documented dynamic
// shape. z.custom carries the static type without forcing a TypeScript
// widening (which would propagate through every component implementation as
// `props.text: string | object`).
const dynamicString = () =>
  z.custom<string>((v) => typeof v === "string" || isDynamicValue(v), {
    message: "Expected a string or a dynamic-value object (e.g. { $bindState: '/path' })",
  });

const dynamicNumber = () =>
  z.custom<number>((v) => typeof v === "number" || isDynamicValue(v), {
    message: "Expected a number or a dynamic-value object",
  });

const dynamicBoolean = () =>
  z.custom<boolean>((v) => typeof v === "boolean" || isDynamicValue(v), {
    message: "Expected a boolean or a dynamic-value object",
  });

const gap = z.enum(["sm", "md", "lg"]).optional();
const textSize = z.enum(["xs", "sm", "base"]).optional();
const buttonVariant = z
  .enum(["default", "outline", "ghost", "secondary", "destructive"])
  .optional();
const buttonSize = z.enum(["xs", "sm", "default", "lg"]).optional();
const badgeVariant = z
  .enum(["default", "secondary", "destructive", "outline", "ghost"])
  .optional();
const controlSize = z.enum(["sm", "default", "lg"]).optional();

const optionItem = z.object({ label: z.string(), value: z.string() });
const radioOptionItem = z.object({
  label: z.string(),
  value: z.string(),
  description: z.string().optional(),
});

const textFieldProps = {
  label: z.string().optional(),
  placeholder: z.string().optional(),
  value: dynamicString().optional(),
  disabled: dynamicBoolean().optional(),
};

export const widgetCatalog = defineCatalog(schema, {
  components: {
    Stack: {
      props: z.object({ gap }).strict(),
      description: WIDGET_COMPONENT_DESCRIPTIONS.Stack,
    },
    Row: {
      props: z.object({ bordered: z.boolean().optional() }).strict(),
      description: WIDGET_COMPONENT_DESCRIPTIONS.Row,
    },
    Grid: {
      props: z.object({ columns: z.number().optional(), gap }).strict(),
      description: WIDGET_COMPONENT_DESCRIPTIONS.Grid,
    },
    Section: {
      props: z.object({ title: z.string().optional() }).strict(),
      description: WIDGET_COMPONENT_DESCRIPTIONS.Section,
    },
    Heading: {
      props: z.object({ text: dynamicString(), level: z.enum(["1", "2", "3"]).optional() }).strict(),
      description: WIDGET_COMPONENT_DESCRIPTIONS.Heading,
    },
    Text: {
      props: z.object({
        text: dynamicString(),
        muted: z.boolean().optional(),
        size: textSize,
      }).strict(),
      description: WIDGET_COMPONENT_DESCRIPTIONS.Text,
    },
    TextBlock: {
      props: z.object({ title: dynamicString(), description: dynamicString().optional() }).strict(),
      description: WIDGET_COMPONENT_DESCRIPTIONS.TextBlock,
    },
    Markdown: {
      props: z.object({ content: dynamicString().optional() }).strict(),
      description: WIDGET_COMPONENT_DESCRIPTIONS.Markdown,
    },
    Badge: {
      props: z.object({ text: dynamicString(), variant: badgeVariant }).strict(),
      description: WIDGET_COMPONENT_DESCRIPTIONS.Badge,
    },
    Button: {
      props: z.object({
        label: dynamicString(),
        variant: buttonVariant,
        size: buttonSize,
        disabled: dynamicBoolean().optional(),
      }).strict(),
      description: WIDGET_COMPONENT_DESCRIPTIONS.Button,
    },
    Checkbox: {
      props: z.object({
        label: dynamicString(),
        description: dynamicString().optional(),
        checked: dynamicBoolean().optional(),
        disabled: dynamicBoolean().optional(),
      }).strict(),
      description: WIDGET_COMPONENT_DESCRIPTIONS.Checkbox,
    },
    Switch: {
      props: z.object({
        label: dynamicString(),
        description: dynamicString().optional(),
        checked: dynamicBoolean().optional(),
        disabled: dynamicBoolean().optional(),
      }).strict(),
      description: WIDGET_COMPONENT_DESCRIPTIONS.Switch,
    },
    Input: {
      props: z.object(textFieldProps).strict(),
      description: WIDGET_COMPONENT_DESCRIPTIONS.Input,
    },
    Textarea: {
      props: z.object({ ...textFieldProps, rows: z.number().optional() }).strict(),
      description: WIDGET_COMPONENT_DESCRIPTIONS.Textarea,
    },
    Select: {
      props: z.object({
        label: z.string().optional(),
        placeholder: z.string().optional(),
        value: z.string().optional(),
        options: z.array(optionItem).optional(),
        disabled: z.boolean().optional(),
      }).strict(),
      description: WIDGET_COMPONENT_DESCRIPTIONS.Select,
    },
    RadioGroup: {
      props: z.object({
        label: z.string().optional(),
        value: z.string().optional(),
        options: z.array(radioOptionItem).optional(),
        disabled: z.boolean().optional(),
      }).strict(),
      description: WIDGET_COMPONENT_DESCRIPTIONS.RadioGroup,
    },
    Slider: {
      props: z.object({
        label: z.string().optional(),
        value: dynamicNumber().optional(),
        min: z.number().optional(),
        max: z.number().optional(),
        step: z.number().optional(),
        disabled: dynamicBoolean().optional(),
      }).strict(),
      description: WIDGET_COMPONENT_DESCRIPTIONS.Slider,
    },
    Avatar: {
      props: z.object({
        src: dynamicString().optional(),
        fallback: dynamicString().optional(),
        size: controlSize,
      }).strict(),
      description: WIDGET_COMPONENT_DESCRIPTIONS.Avatar,
    },
    Spinner: {
      props: z.object({ size: controlSize }).strict(),
      description: WIDGET_COMPONENT_DESCRIPTIONS.Spinner,
    },
    Image: {
      props: z.object({
        src: dynamicString(),
        alt: dynamicString().optional(),
        rounded: z.boolean().optional(),
      }).strict(),
      description: WIDGET_COMPONENT_DESCRIPTIONS.Image,
    },
    Chart: {
      props: z.object({
        type: z.enum(["line", "bar", "area", "pie"]).optional(),
        data: z.array(z.record(z.string(), z.unknown())).optional(),
        series: z.array(
          z.object({
            key: z.string(),
            label: z.string().optional(),
            color: z.string().optional(),
          }),
        ).optional(),
        categoryKey: z.string().optional(),
        height: z.number().optional(),
        stacked: z.boolean().optional(),
        showLegend: z.boolean().optional(),
        showGrid: z.boolean().optional(),
      }),
      description: WIDGET_COMPONENT_DESCRIPTIONS.Chart,
    },
    Card: {
      props: z.object({}).strict(),
      description: WIDGET_COMPONENT_DESCRIPTIONS.Card,
    },
    Accent: {
      props: z.object({
        color: z.enum(["yellow", "blue", "purple", "green", "orange", "red"]),
      }).strict(),
      description: WIDGET_COMPONENT_DESCRIPTIONS.Accent,
    },
    Collapsible: {
      props: z.object({ title: z.string(), defaultOpen: z.boolean().optional() }).strict(),
      description: WIDGET_COMPONENT_DESCRIPTIONS.Collapsible,
    },
    Tabs: {
      props: z.object({ tabs: z.array(optionItem) }).strict(),
      description: WIDGET_COMPONENT_DESCRIPTIONS.Tabs,
    },
    Table: {
      props: z.object({ caption: z.string().optional() }).strict(),
      description: WIDGET_COMPONENT_DESCRIPTIONS.Table,
    },
    TableHeader: {
      props: z.object({}).strict(),
      description: WIDGET_COMPONENT_DESCRIPTIONS.TableHeader,
    },
    TableBody: {
      props: z.object({}).strict(),
      description: WIDGET_COMPONENT_DESCRIPTIONS.TableBody,
    },
    TableRow: {
      props: z.object({}).strict(),
      description: WIDGET_COMPONENT_DESCRIPTIONS.TableRow,
    },
    TableHead: {
      props: z.object({ text: dynamicString() }).strict(),
      description: WIDGET_COMPONENT_DESCRIPTIONS.TableHead,
    },
    TableCell: {
      props: z.object({ text: dynamicString().optional() }).strict(),
      description: WIDGET_COMPONENT_DESCRIPTIONS.TableCell,
    },
    Dialog: {
      props: z.object({
        trigger: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
      }).strict(),
      description: WIDGET_COMPONENT_DESCRIPTIONS.Dialog,
    },
    Drawer: {
      props: z.object({
        trigger: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        side: z.enum(["top", "bottom", "left", "right"]).optional(),
      }).strict(),
      description: WIDGET_COMPONENT_DESCRIPTIONS.Drawer,
    },
    Popover: {
      props: z.object({ trigger: z.string() }).strict(),
      description: WIDGET_COMPONENT_DESCRIPTIONS.Popover,
    },
    Tooltip: {
      props: z.object({ text: z.string() }).strict(),
      description: WIDGET_COMPONENT_DESCRIPTIONS.Tooltip,
    },
    DropdownMenu: {
      props: z.object({ trigger: z.string() }).strict(),
      description: WIDGET_COMPONENT_DESCRIPTIONS.DropdownMenu,
    },
    MenuItem: {
      props: z.object({
        label: z.string(),
        variant: z.enum(["default", "destructive"]).optional(),
        disabled: z.boolean().optional(),
      }).strict(),
      description: WIDGET_COMPONENT_DESCRIPTIONS.MenuItem,
    },
    Separator: {
      props: z.object({}).strict(),
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

// ---------------------------------------------------------------------------
// Pre-render spec validation
// ---------------------------------------------------------------------------

// Why this exists: @json-render/core's `catalog.validate()` builds its
// per-element prop schema via `propsOf(elementType)`, which falls back to
// `z.record(z.string(), z.unknown())` whenever the catalog has more than one
// component (which is always — we have ~38). So `catalog.validate` silently
// accepts unknown props at the element level and the strict `.strict()` on
// each component is decorative for that path. We get the actual guarantee
// only by walking elements ourselves and running each component's
// `.props.safeParse(...)` directly.
//
// The walker accepts dynamic-value objects in slots where the component's
// schema uses `dynamicString()` / `dynamicNumber()` / `dynamicBoolean()` (via
// z.custom predicates above) — no pre-resolution needed.

export type WidgetPropsIssue = {
  elementKey: string;
  component: string;
  path: string;
  message: string;
};

export type WidgetPropsValidation =
  | { success: true; issues: [] }
  | { success: false; issues: WidgetPropsIssue[] };

const COMPONENT_SCHEMAS = widgetCatalog.data.components as Record<
  string,
  { props?: { safeParse: (v: unknown) => z.ZodSafeParseResult<unknown> } } | undefined
>;

export function validateWidgetProps(spec: {
  elements: Record<string, { type: string; props: Record<string, unknown> }>;
}): WidgetPropsValidation {
  const issues: WidgetPropsIssue[] = [];
  for (const [elementKey, element] of Object.entries(spec.elements)) {
    const entry = COMPONENT_SCHEMAS[element.type];
    if (!entry?.props) continue;
    const parsed = entry.props.safeParse(element.props);
    if (parsed.success) continue;
    for (const issue of parsed.error.issues) {
      issues.push({
        elementKey,
        component: element.type,
        path: issue.path.length === 0 ? "<root>" : issue.path.map(String).join("."),
        message: issue.message,
      });
    }
  }
  return issues.length === 0
    ? { success: true, issues: [] }
    : { success: false, issues };
}
