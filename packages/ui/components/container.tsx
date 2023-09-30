import * as React from "react";

import { cn } from "../lib/cn";

const Container = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<"div">
>(({ className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={cn(
        "w-full rounded-lg bg-ui-bg-base px-8 pb-8 pt-6 shadow-elevation-card-rest",
        className,
      )}
      {...props}
    />
  );
});
Container.displayName = "Container";

export { Container };
