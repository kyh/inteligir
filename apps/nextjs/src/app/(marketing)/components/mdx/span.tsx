import type { FC } from "react";
import { clx } from "@inteligir/ui";

export const Span: FC<React.HTMLProps<HTMLSpanElement>> = ({
  children,
  className,
  ...props
}) => {
  return (
    <span {...props} className={clx("", className)}>
      {children}
    </span>
  );
};
