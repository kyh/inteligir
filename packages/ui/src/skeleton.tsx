"use client";

import { cn } from "./utils";

export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-primary/4", className)}
      {...props}
    />
  );
}

export const WithSkeleton = ({
  children,
  className,
  isLoading,
  ...props
}: React.ComponentProps<"div"> & { isLoading: boolean }) => (
  <div className={cn("relative w-fit", className)} {...props}>
    {children}
    {isLoading && (
      <>
        <div className={cn("absolute inset-0 bg-background", className)} />
        <Skeleton className={cn("absolute inset-0", className)} />
      </>
    )}
  </div>
);
