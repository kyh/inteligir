import { classed, type VariantProps } from "@tw-classed/react";

export const Badge = classed("span", {
  base: "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium",
  variants: {
    color: {
      normal: "bg-gray-800 text-zinc-400",
      green: "bg-emerald-100 text-emerald-800",
      transparent: "bg-transparent border border-white/10",
      // Update these
      success: "bg-green-500/10 text-green-700",
      warn: "bg-yellow-100/10 text-yellow-800",
      error: "bg-red-500/10 text-red-800",
      info: "bg-blue-500/10 text-blue-800",
      custom: "",
    },
  },
  defaultVariants: {
    color: "normal",
  },
});

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
