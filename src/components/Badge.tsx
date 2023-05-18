import { classed } from "@tw-classed/react";

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
