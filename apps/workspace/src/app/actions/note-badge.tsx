import { Badge } from "@repo/ui/components/badge";
import { cn } from "@repo/ui/lib/cn";
import { FileTextIcon } from "lucide-react";
import type { ReactNode } from "react";

// `children` is the chip's trailing control, drawn after the path
export const NoteBadge = ({
  path,
  className,
  children,
}: {
  path: string;
  className?: string | undefined;
  children?: ReactNode;
}) => (
  <Badge variant="outline" className={cn("gap-1 bg-surface-raised", className)}>
    <FileTextIcon className="size-3" />
    {path}
    {children}
  </Badge>
);
