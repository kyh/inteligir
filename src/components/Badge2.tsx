import { classed } from "@tw-classed/react";

export const Badge = classed("span", {
  base: "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium",
  variants: {
    color: {
      normal: "bg-gray-800 text-gray-400",
      green: "bg-emerald-100 text-emerald-800",
      transparent: "bg-transparent border border-white/10",
    },
  },
  defaultVariants: {
    color: "normal",
  },
});
