import { cloneElement } from "react";
import clsx from "clsx";

type Props = {
  label: string;
  name: string;
  className?: string;
  placeholder?: string;
  children?: any;
  inputProps?: React.HTMLProps<HTMLInputElement>;
};

export const FormField = ({
  label,
  name,
  className = "",
  placeholder,
  children,
  inputProps = {},
}: Props) => {
  const fieldProps = {
    id: name,
    type: "text",
    className:
      "block w-full border-0 p-0 text-white placeholder-gray-600 bg-transparent focus:ring-0",
    name,
    placeholder,
    ...inputProps,
  };

  const field = children ? (
    cloneElement(children, fieldProps)
  ) : (
    <input {...fieldProps} />
  );

  return (
    <div
      className={clsx(
        `relative border border-gray-700 rounded-md px-3 py-2 focus-within:z-10 focus-within:ring-1 focus-within:ring-teal-600 focus-within:border-teal-600`,
        className
      )}
    >
      <label
        htmlFor={name}
        className="block text-sm font-medium text-gray-400 pb-1 cursor-text"
      >
        {label}
      </label>
      {field}
    </div>
  );
};
