import type { FC } from "react";
import { clx } from "@inteligir/ui";

export const Pre: FC<React.HTMLProps<HTMLPreElement>> = ({
  children,
  className,
  ...props
}) => {
  return (
    <pre
      {...props}
      className={clx(
        "mb-2 mt-4 overflow-auto whitespace-pre rounded-md bg-gray-100 p-4 text-sm",
        className,
      )}
    >
      {children}
    </pre>
  );
};
