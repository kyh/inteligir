import type { FC } from "react";
import { clx } from "@inteligir/ui";

export const Li: FC<React.HTMLProps<HTMLLIElement>> = ({
  children,
  className,
  ...props
}) => {
  return (
    <li {...props} className={clx("mb-1", className)}>
      {children}
    </li>
  );
};
