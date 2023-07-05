import { classed } from "~/lib/utils";

export const Text = classed("span", {
  base: "text-base",
  variants: {
    variant: {
      heading1: "text-3xl font-semibold sm:text-4xl",
      heading2: "text-xl font-semibold sm:text-2xl",
      label: "text-xs font-semibold uppercase tracking-wider",
    },
  },
});
