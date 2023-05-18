import { classed, type VariantProps } from "@tw-classed/react";

export const Tag = classed("span", {
  base: "font-mono text-[0.625rem] font-semibold leading-6",
  variants: {
    variant: {
      small: "px-1",
      medium: "rounded-lg px-1.5 ring-1 ring-inset",
    },
    color: {
      emerald: "ring-emerald-400/30 bg-emerald-400/10 text-emerald-400",
      sky: "ring-sky-400/30 bg-sky-400/10 text-sky-400",
      amber: "ring-amber-400/30 bg-amber-400/10 text-amber-400",
      rose: "ring-rose-400/30 bg-rose-400/10 text-rose-400",
      gray: "ring-gray-400/30 bg-gray-400/10 text-zinc-400",
    },
  },
  defaultVariants: {
    variant: "medium",
    color: "gray",
  },
});

export const valueColorMap: Record<string, VariantProps<typeof Tag>["color"]> =
  {
    GET: "emerald",
    POST: "sky",
    PUT: "amber",
    DELETE: "rose",
  };
