import { VisibilityConditionSchema } from "@json-render/core";
import { z } from "zod";

import { type InstallWidgetInput, type Shell } from "@/shared/shell";
import {
  JSON_WIDGET_COMPONENT_TYPES,
  WIDGET_ACTION_NAMES,
  type JsonWidgetComponentType,
  type WidgetActionName,
  type WidgetActionRequest,
  type WidgetSpec,
  type WidgetSpecElement,
  type WidgetSpecInput,
} from "@/shared/widget-spec";

function stringEnumSchema<T extends string>(values: readonly T[], label: string): z.ZodType<T> {
  return z.custom<T>(
    (value) => typeof value === "string" && values.some((candidate) => candidate === value),
    { message: `Unknown ${label}` },
  );
}

const ComponentTypeSchema: z.ZodType<JsonWidgetComponentType> = stringEnumSchema(
  JSON_WIDGET_COMPONENT_TYPES,
  "widget component type",
);

const ActionNameSchema: z.ZodType<WidgetActionName> = stringEnumSchema(
  WIDGET_ACTION_NAMES,
  "widget action",
);

const ActionRequestSchema: z.ZodType<WidgetActionRequest> = z.object({
  action: ActionNameSchema,
  params: z.record(z.string(), z.unknown()).optional(),
});

const ActionBindingValueSchema = z.union([ActionRequestSchema, z.array(ActionRequestSchema)]);

const ElementSchema: z.ZodType<WidgetSpecElement> = z.object({
  type: ComponentTypeSchema,
  props: z.record(z.string(), z.unknown()).default({}),
  children: z.array(z.string()).optional(),
  visible: VisibilityConditionSchema.optional(),
  repeat: z
    .object({
      statePath: z.string(),
      key: z.string().optional(),
    })
    .optional(),
  on: z.record(z.string(), ActionBindingValueSchema).optional(),
  watch: z.record(z.string(), ActionBindingValueSchema).optional(),
});

const WidgetSpecSchema: z.ZodType<WidgetSpec> = z.object({
  root: z.string(),
  elements: z.record(z.string(), ElementSchema),
  state: z.record(z.string(), z.unknown()).optional(),
});

export const GeometrySchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  minW: z.number().optional(),
  minH: z.number().optional(),
});

export const RectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

const JsonUiDefSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  revision: z.number(),
  singleton: z.literal(false),
  permanent: z.literal(false),
  defaultGeometry: GeometrySchema,
  source: z.object({
    kind: z.literal("json-ui"),
    spec: WidgetSpecSchema,
    createdAt: z.number(),
    updatedAt: z.number(),
  }),
});

const PinnedPlacementSchema = z.object({
  surface: z.literal("pinned"),
  geometry: GeometrySchema,
});

const FloatingPlacementSchema = z.object({
  surface: z.literal("floating"),
  rect: RectSchema,
  z: z.number(),
});

const PlacementSchema = z.discriminatedUnion("surface", [
  PinnedPlacementSchema,
  FloatingPlacementSchema,
]);

const WidgetInstanceSchema = z.object({
  instanceId: z.string(),
  widgetId: z.string(),
  placement: PlacementSchema,
  state: z.record(z.string(), z.unknown()),
});

export const ShellSchema: z.ZodType<Shell> = z.object({
  version: z.literal(2),
  customDefs: z.array(JsonUiDefSchema),
  instances: z.array(WidgetInstanceSchema),
  // Default for forward-compat with on-disk shells written before this field
  // existed; new installs start empty.
  archivedStates: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
});

export const InstallWidgetInputSchema: z.ZodType<InstallWidgetInput> = z.object({
  id: z.string().min(1).optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  spec: WidgetSpecSchema,
});

export function parseWidgetSpec(input: WidgetSpecInput): WidgetSpec {
  const spec = WidgetSpecSchema.parse(input);
  validateWidgetSpec(spec);
  return spec;
}

function validateWidgetSpec(spec: WidgetSpec): void {
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
