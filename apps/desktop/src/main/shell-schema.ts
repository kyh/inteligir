import { z } from "zod";

import type { Shell } from "@/shared/shell";
import { type WidgetSpec, parseWidgetSpec } from "@/shared/widget-spec";

// WidgetSpec is validated via TypeBox in widget-spec.ts. Wrap the parser as a
// Zod schema so we can compose it into ShellSchema for the on-disk JsonStore.
const WidgetSpecZod: z.ZodType<WidgetSpec> = z.unknown().transform((value, ctx) => {
  try {
    return parseWidgetSpec(value);
  } catch (err) {
    ctx.addIssue({
      code: "custom",
      message: err instanceof Error ? err.message : "invalid widget spec",
    });
    return z.NEVER;
  }
});

const GeometrySchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  minW: z.number().optional(),
  minH: z.number().optional(),
});

const RectSchema = z.object({
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
  defaultGeometry: GeometrySchema,
  source: z.object({
    kind: z.literal("json-ui"),
    spec: WidgetSpecZod,
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
