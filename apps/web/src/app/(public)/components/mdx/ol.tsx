import type { FC } from "react";
import { clx } from "@inteligir/ui";

export const Ol: FC<React.HTMLProps<HTMLOListElement>> = ({
  children,
  className,
  ...props
}) => {
  return (
    <ol {...props} className={clx("list-decimal pl-5", className)} type="1">
      {children}
    </ol>
  );
};
