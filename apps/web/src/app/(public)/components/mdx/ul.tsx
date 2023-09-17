import type { FC } from "react";
import { cn } from "ui/lib/cn";

export const Ul: FC<React.HTMLProps<HTMLUListElement>> = ({
  children,
  className,
  ...props
}) => {
  return (
    <ul {...props} className={cn("list-disc pl-5", className)}>
      {children}
    </ul>
  );
};
