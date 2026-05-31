import { VisibilityConditionSchema } from "@json-render/core";
import { Type } from "@sinclair/typebox";
import { z } from "zod";

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

function zodStringEnum<T extends string>(values: readonly T[], label: string): z.ZodType<T> {
  return z.custom<T>(
    (value) => typeof value === "string" && values.some((candidate) => candidate === value),
    { message: `Unknown ${label}` },
  );
}

const ComponentTypeSchema: z.ZodType<JsonWidgetComponentType> = zodStringEnum(
  JSON_WIDGET_COMPONENT_TYPES,
  "widget component type",
);

const ActionNameSchema: z.ZodType<WidgetActionName> = zodStringEnum(
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

export const WidgetSpecSchema: z.ZodType<WidgetSpec> = z.object({
  root: z.string(),
  elements: z.record(z.string(), ElementSchema),
  state: z.record(z.string(), z.unknown()).optional(),
});

function literalUnion<T extends string>(values: readonly T[]) {
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

export const WidgetSpecParam = Type.Object(
  {
    root: Type.String({ description: "Key of the root element in elements" }),
    elements: Type.Record(
      Type.String(),
      Type.Object(
        {
          type: ComponentTypeParam,
          props: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
          children: Type.Optional(Type.Array(Type.String())),
          visible: Type.Optional(Type.Unknown()),
          repeat: Type.Optional(
            Type.Object(
              {
                statePath: Type.String(),
                key: Type.Optional(Type.String()),
              },
              { additionalProperties: false },
            ),
          ),
          on: Type.Optional(Type.Record(Type.String(), ActionBindingParam)),
          watch: Type.Optional(Type.Record(Type.String(), ActionBindingParam)),
        },
        { additionalProperties: false },
      ),
    ),
    state: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: false },
);

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
