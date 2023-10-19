import type { FC } from "react";
import { clx } from "@inteligir/ui";

export const Ul: FC<React.HTMLProps<HTMLUListElement>> = ({
  children,
  className,
  ...props
}) => {
  return (
    <ul {...props} className={clx("list-disc pl-5", className)}>
      {children}
    </ul>
  );
};
