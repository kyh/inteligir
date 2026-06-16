// Layout + text primitives for the widget catalog.

import { Label } from "@repo/ui/components/label";
import { cn } from "@repo/ui/lib/utils";

import type { BaseProps } from "@/renderer/shell/catalog/shared";

const gapClass = (gap?: "sm" | "md" | "lg") =>
  gap === "sm" ? "gap-1.5" : gap === "md" ? "gap-2.5" : "gap-3.5";

export function Stack({ props, children }: BaseProps<{ gap?: "sm" | "md" | "lg" }>) {
  return <div className={cn("flex flex-col", gapClass(props.gap))}>{children}</div>;
}

export function Grid({
  props,
  children,
}: BaseProps<{ columns?: number; gap?: "sm" | "md" | "lg" }>) {
  const columns = props.columns && props.columns > 0 ? Math.floor(props.columns) : 2;
  return (
    <div
      className={cn("grid", gapClass(props.gap))}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {children}
    </div>
  );
}

export function Section({ props, children }: BaseProps<{ title?: string }>) {
  return (
    <div className="flex flex-col gap-1.5">
      {props.title ? (
        <Label className="text-[11px] leading-4 font-medium text-muted-foreground">
          {props.title}
        </Label>
      ) : null}
      {children}
    </div>
  );
}

// Only emit press when the click landed on the row itself, not on an
// interactive child like a Button or Checkbox — otherwise activating a
// settings-style control inside the row would fire both the child's bound
// action and the row's.
const INTERACTIVE_CHILD_SELECTOR =
  "button, input, textarea, label, [role='button'], [role='checkbox']";

export function Row({ props, emit, children }: BaseProps<{ bordered?: boolean }>) {
  const bordered = props.bordered !== false;
  const onClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (e.target instanceof Element && e.target.closest(INTERACTIVE_CHILD_SELECTOR)) {
      return;
    }
    emit("press");
  };
  return (
    <div
      onClick={onClick}
      className={cn(
        "flex items-center justify-between gap-2",
        // Borderless translucent well — the refs' in-card row language.
        bordered && "object-row rounded-[12px] border border-[var(--object-row-border)] px-3 py-2",
      )}
    >
      {children}
    </div>
  );
}

const headingClass = {
  "1": "text-[18px] leading-6 font-semibold",
  "2": "text-[15px] leading-5 font-medium",
  "3": "text-[12px] leading-4 font-medium text-muted-foreground",
};

export function Heading({ props }: BaseProps<{ text: string; level?: "1" | "2" | "3" }>) {
  const level = props.level ?? "3";
  const className = headingClass[level];
  if (level === "1") return <h1 className={className}>{props.text}</h1>;
  if (level === "2") return <h2 className={className}>{props.text}</h2>;
  return <h3 className={className}>{props.text}</h3>;
}

// "sm" (12px) is the default body size. "xs" (11px) is for captions, "base"
// (14px) for emphasized inline text.
const textSizeClass = {
  xs: "text-[11px]",
  sm: "text-xs",
  base: "text-sm",
};

export function Text({
  props,
}: BaseProps<{ text: string; muted?: boolean; size?: "xs" | "sm" | "base" }>) {
  return (
    <span
      className={cn(
        textSizeClass[props.size ?? "sm"],
        props.muted ? "text-muted-foreground" : "text-foreground",
      )}
    >
      {props.text}
    </span>
  );
}

export function TextBlock({ props }: BaseProps<{ title: string; description?: string }>) {
  return (
    <span className="flex flex-col">
      <span className="text-[13px] leading-4 text-foreground">{props.title}</span>
      {props.description ? (
        <span className="text-[11px] leading-4 text-muted-foreground">{props.description}</span>
      ) : null}
    </span>
  );
}
