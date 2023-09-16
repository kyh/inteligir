import type { FC } from "react";
import { cn } from "@/lib/cn";

export const P: FC<React.HTMLProps<HTMLParagraphElement>> = ({
  children,
  className,
  ...props
}) => {
  return (
    <p {...props} className={cn("my-5 leading-relaxed", className)}>
      {children}
    </p>
  );
};
