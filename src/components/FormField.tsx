import { cloneElement } from "react";
import { classed, type VariantProps } from "@tw-classed/react";
import clsx from "clsx";

const BaseFormField = classed.div({
  base: "relative rounded-md border border-white/20 focus-within:z-10 focus-within:border-emerald-600 focus-within:ring-1 focus-within:ring-emerald-600",
  variants: {
    size: {
      xs: "py-1 px-2",
      md: "py-2 px-3",
    },
  },
  defaultVariants: {
    size: "md",
  },
});

type BaseFormFieldVariants = VariantProps<typeof BaseFormField>;

type Props = {
  name: string;
  label?: string;
  className?: string;
  placeholder?: string;
  children?: any;
  inputProps?: React.HTMLProps<HTMLInputElement>;
} & BaseFormFieldVariants;

export const FormField = ({
  label,
  name,
  className = "",
  placeholder,
  children,
  inputProps = {},
  ...props
}: Props) => {
  const fieldProps = {
    id: name,
    type: "text",
    name,
    placeholder,
    ...inputProps,
    className: clsx(
      "block w-full border-0 p-0 text-white placeholder-gray-600 bg-transparent focus:ring-0",
      inputProps.className
    ),
  };

  const field = children ? (
    cloneElement(children, fieldProps)
  ) : (
    <input {...fieldProps} />
  );

  return (
    <BaseFormField className={className} {...props}>
      {label && (
        <label
          htmlFor={name}
          className="block cursor-text pb-1 text-sm font-medium text-gray-400"
        >
          {label}
        </label>
      )}
      {field}
    </BaseFormField>
  );
};
