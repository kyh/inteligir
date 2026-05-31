import { z } from "zod";

import { type InstallWidgetInput, type Shell, WIDGET_SURFACES } from "@/shared/shell";
import { WidgetSpecSchema } from "@/shared/widget-spec-schema";

export const SurfaceSchema = z.enum(WIDGET_SURFACES);

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
