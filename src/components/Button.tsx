import { classed } from "@tw-classed/react";

export const Button = classed("button", {
  base: "inline-flex items-center border shadow-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-40",
  variants: {
    variant: {
      normal:
        "border-white/20 bg-black-700 hover:bg-gray-900 hover:text-white disabled:hover:bg-black",
      primary:
        "bg-emerald-400/10 text-emerald-400 border-emerald-400/20 hover:bg-emerald-400/10 hover:text-emerald-300 hover:border-emerald-300",
      outline:
        "text-gray-400 border-white/20 hover:bg-white/5 hover:text-white",
      text: "text-emerald-500 hover:text-emerald-300 shadow-none border-0",
    },
    size: {
      none: "px-0 py-0",
      sm: "px-3 py-1 text-xs",
      md: "px-4 py-2 text-sm",
    },
    shape: {
      normal: "rounded-full",
      square: "rounded",
    },
    selected: {
      true: "bg-emerald-400/10 border-emerald-400/20",
    },
  },
  defaultVariants: {
    variant: "normal",
    size: "md",
    shape: "normal",
  },
});
