import { z } from "zod";

import type { Parse } from "./rich-block-chrome";

const NAMED_COLORS = new Set([
  "black",
  "white",
  "red",
  "green",
  "blue",
  "yellow",
  "orange",
  "purple",
  "pink",
  "brown",
  "gray",
  "grey",
  "cyan",
  "magenta",
  "lime",
  "navy",
  "teal",
  "olive",
  "maroon",
  "aqua",
  "silver",
  "fuchsia",
]);

const colorSchema = z
  .string()
  .refine(
    (value) =>
      /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/u.test(value) || NAMED_COLORS.has(value),
    { message: "color must be #RGB/#RRGGBB/#RRGGBBAA or a named color" },
  );

const pointSchema = z.strictObject({
  color: colorSchema.optional(),
  label: z.string(),
  value: z.number(),
});

const seriesSchema = z.strictObject({
  color: colorSchema.optional(),
  data: z.array(pointSchema).min(1),
  name: z.string(),
});

const optionsSchema = z.strictObject({
  showGrid: z.boolean().optional(),
  showLegend: z.boolean().optional(),
});

const chartSchema = z.union([
  z.strictObject({
    data: z.array(pointSchema).min(1),
    options: optionsSchema.optional(),
    title: z.string().optional(),
    type: z.enum(["bar", "line", "area", "stacked-bar"]),
  }),
  z.strictObject({
    options: optionsSchema.optional(),
    series: z.array(seriesSchema).min(1),
    title: z.string().optional(),
    type: z.enum(["bar", "line", "area"]),
  }),
]);

export type ChartPayload = z.infer<typeof chartSchema>;

export const parseChartPayload = (value: string) => {
  let json: unknown;

  try {
    json = JSON.parse(value);
  } catch {
    return { ok: false, reason: "The payload is not valid JSON." } satisfies Parse<ChartPayload>;
  }

  const parsed = chartSchema.safeParse(json);

  if (!parsed.success) {
    const [first] = parsed.error.issues;

    return {
      ok: false,
      reason: `Not a chart: ${first?.message ?? "shape mismatch"}`,
    } satisfies Parse<ChartPayload>;
  }

  return { ok: true, payload: parsed.data } satisfies Parse<ChartPayload>;
};
