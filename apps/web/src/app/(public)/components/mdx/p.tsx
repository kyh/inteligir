import type { FC } from "react";
import { clx } from "@inteligir/ui";

export const P: FC<React.HTMLProps<HTMLParagraphElement>> = ({
  children,
  className,
  ...props
}) => {
  return (
    <p {...props} className={clx("my-5 leading-relaxed", className)}>
      {children}
    </p>
  );
};
