// Vendored from shadcn/ui (github.com/shadcn-ui/ui), MIT.
import type { ComponentProps } from "react";

import { cn } from "@repo/ui/lib/cn";

const Card = ({ className, ...props }: ComponentProps<"div">) => (
  <div
    data-slot="card"
    className={cn(
      "flex flex-col gap-(--card-spacing) overflow-hidden rounded-[min(var(--radius-4xl),24px)] bg-card py-(--card-spacing) text-body text-card-foreground shadow-sm ring-1 ring-foreground/5 [--card-spacing:--spacing(4)] dark:ring-foreground/10",
      className,
    )}
    {...props}
  />
);

const CardHeader = ({ className, ...props }: ComponentProps<"div">) => (
  <div
    data-slot="card-header"
    className={cn(
      "grid auto-rows-min items-start gap-1.5 px-(--card-spacing) has-data-[slot=card-description]:grid-rows-[auto_auto]",
      className,
    )}
    {...props}
  />
);

const CardTitle = ({ className, ...props }: ComponentProps<"div">) => (
  <div
    data-slot="card-title"
    className={cn("text-subtitle font-medium text-foreground", className)}
    {...props}
  />
);

const CardDescription = ({ className, ...props }: ComponentProps<"div">) => (
  <div
    data-slot="card-description"
    className={cn("text-body text-muted-foreground", className)}
    {...props}
  />
);

const CardContent = ({ className, ...props }: ComponentProps<"div">) => (
  <div data-slot="card-content" className={cn("px-(--card-spacing)", className)} {...props} />
);

const CardFooter = ({ className, ...props }: ComponentProps<"div">) => (
  <div
    data-slot="card-footer"
    className={cn("flex items-center px-(--card-spacing)", className)}
    {...props}
  />
);

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
