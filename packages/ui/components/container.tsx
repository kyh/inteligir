import * as React from "react";
import { cn } from "../lib/cn";

const Container = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<"div">
>(({ className, ...props }, ref) => {
  return (
    <div
      className={cn(
        "w-full rounded-lg bg-ui-bg-base px-8 pb-8 pt-6 shadow-elevation-card-rest",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Container.displayName = "Container";

export { Container };
