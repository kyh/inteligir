import type { FC } from "react";
import { cn } from "ui/lib/cn";

export const Span: FC<React.HTMLProps<HTMLSpanElement>> = ({
  children,
  className,
  ...props
}) => {
  return (
    <span {...props} className={cn("", className)}>
      {children}
    </span>
  );
};
