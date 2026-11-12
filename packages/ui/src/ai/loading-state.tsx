"use client";
// Vendored from Beautiful UI (beautifului.dev), MIT.

import { useEffect, useState } from "react";
import type { HTMLAttributes, RefAttributes } from "react";

import { cn } from "@repo/ui/lib/cn";

const DOTS = Array.from({ length: 9 }, (_, i) => {
  const row = Math.floor(i / 3);
  const column = i % 3;
  return { delayMs: (column + Math.abs(row - 1)) * 90, id: `r${String(row)}c${String(column)}` };
});

const LoaderGrid = () => (
  <span aria-hidden className="grid shrink-0 grid-cols-[repeat(3,4px)] gap-[1.5px]">
    {DOTS.map(({ id, delayMs }) => (
      <span
        key={id}
        className="bui-pixel size-[4px] rounded-full bg-ink opacity-[0.15]"
        style={{ animationDelay: `${String(delayMs)}ms` }}
      />
    ))}
  </span>
);

const useElapsedLabel = (): string => {
  const [clock, setClock] = useState(() => {
    const mountedAt = Date.now();
    return { mountedAt, now: mountedAt };
  });
  useEffect(() => {
    const timer = setInterval(() => {
      setClock((current) => ({ ...current, now: Date.now() }));
    }, 100);
    return () => {
      clearInterval(timer);
    };
  }, []);
  const seconds = Math.max(0, (clock.now - clock.mountedAt) / 1000);
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  return `${String(Math.floor(seconds / 60))}m ${(seconds % 60).toFixed(1)}s`;
};

interface LoadingStateProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
}

const LoadingState = ({
  label,
  className,
  ref,
  ...props
}: LoadingStateProps & RefAttributes<HTMLDivElement>) => {
  const elapsed = useElapsedLabel();
  return (
    <div
      ref={ref}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- the slot's ref and props are typed to HTMLDivElement
      role="status"
      data-slot="loading-state"
      className={cn("flex w-fit items-center gap-2.5", className)}
      {...props}
    >
      <LoaderGrid />
      <span className="bui-shimmer-text text-subtitle font-medium">{label}</span>
      <span className="font-mono text-body text-ink-3 tabular-nums">{elapsed}</span>
    </div>
  );
};

export { LoadingState };
