import type { FC } from "react";
import { cn } from "@/lib/cn";

export const Ol: FC<React.HTMLProps<HTMLOListElement>> = ({
  children,
  className,
  ...props
}) => {
  return (
    <ol {...props} className={cn("list-decimal pl-5", className)} type="1">
      {children}
    </ol>
  );
};
