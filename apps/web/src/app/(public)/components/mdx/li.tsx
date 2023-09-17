import type { FC } from "react";
import { cn } from "ui/lib/cn";

export const Li: FC<React.HTMLProps<HTMLLIElement>> = ({
  children,
  className,
  ...props
}) => {
  return (
    <li {...props} className={cn("mb-1", className)}>
      {children}
    </li>
  );
};
