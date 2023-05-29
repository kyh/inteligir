import { classed } from "@tw-classed/react";

const BaseTextField = classed("div", {
  base: "flex flex-col space-y-1",
});

const BaseLabel = classed("label", {
  base: "w-full text-sm font-medium text-zinc-400 flex flex-col gap-1",
});

const BaseInput = classed("input", {
  base: "block w-full rounded-md border-0 bg-transparent py-1.5 text-white shadow-sm ring-1 ring-inset ring-white/10 transition focus:ring-1 focus:ring-inset focus:ring-primary-500",
  variants: {
    size: {
      none: "px-0 py-0",
      sm: "px-3 py-1 text-xs",
      md: "px-4 py-2 text-sm",
    },
  },
  defaultVariants: {
    size: "md",
  },
});

const BaseHint = classed("span", {
  base: "text-sm text-zinc-500",
  variants: {
    color: {
      error: "text-red-500",
    },
  },
});

type TextFieldComponentType = typeof BaseTextField & {
  Label: typeof BaseLabel;
  Hint: typeof BaseHint;
  Input: typeof BaseInput;
};

export const TextField = BaseTextField as TextFieldComponentType;

TextField.Hint = BaseHint;
TextField.Label = BaseLabel;
TextField.Input = BaseInput;
