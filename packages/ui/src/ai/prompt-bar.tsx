"use client";
// Vendored from Beautiful UI (beautifului.dev), MIT.

import { forwardRef } from "react";
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  KeyboardEvent,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@repo/ui/lib/utils";
import { GlideList } from "@repo/ui/ai/glide-list";

/* ─────────────────────────────────────────────────────────
 * PROMPT BAR — a composer with @ sources, / commands and a
 * model picker
 *
 * Two things upstream ships are deliberately absent.
 *
 * `glimm` — a WebGL-shader and audio-sweep package — drove a
 * rainbow sweep across the bar's interior on model change, plus a
 * sound. THE DEPENDENCY IS NOT ADDED: it is decoration, this app
 * plays no sound, and this package has been shedding render
 * libraries, not gaining them. The model picker still changes; it
 * just does not paint a shader while doing it.
 *
 * And the brand marks (Figma, Slack, Gmail SVGs inlined as its @
 * sources) are gone — a design system should not carry other
 * companies' logos. Source rows take an `icon` instead.
 *
 * NOTE this is not the app's own composer: that one is built on
 * fluid's `InputMessage` and carries the dictation contract. This
 * is Beautiful UI's, carried whole for the gallery.
 * ───────────────────────────────────────────────────────── */

/** The trailing `@thing` or `/thing` being typed, if any. Exported because
 *  it is the useful pure part: a caller needs it to drive its own menu. */
export function parsePromptToken(
  draft: string,
): { kind: "at" | "slash"; query: string; start: number } | null {
  const match = /(^|\s)([@/])([\w-]*)$/u.exec(draft);
  if (match === null) return null;
  const lead = match[1] ?? "";
  const sigil = match[2];
  return {
    kind: sigil === "@" ? "at" : "slash",
    query: (match[3] ?? "").toLowerCase(),
    start: match.index + lead.length,
  };
}

const promptBarVariants = cva(
  "flex w-full flex-col bg-surface-raised shadow-surface-2 transition-[border-radius] duration-200",
  {
    variants: {
      shape: {
        rounded: "rounded-xl",
        pill: "rounded-[22px]",
      },
    },
    defaultVariants: { shape: "rounded" },
  },
);

export interface PromptBarProps
  extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof promptBarVariants> {}

const PromptBar = forwardRef<HTMLDivElement, PromptBarProps>(
  ({ className, shape, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="prompt-bar"
      className={cn(promptBarVariants({ shape }), className)}
      {...props}
    />
  ),
);
PromptBar.displayName = "PromptBar";

/** Context chips above the field — sources the prompt will carry. */
const PromptBarSources = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="prompt-bar-sources"
      className={cn("flex flex-wrap items-center gap-1.5 px-3 pt-2.5", className)}
      {...props}
    />
  ),
);
PromptBarSources.displayName = "PromptBarSources";

export interface PromptBarSourceProps extends HTMLAttributes<HTMLSpanElement> {
  icon?: ReactNode;
  /** Present renders a remove control. */
  onRemove?: () => void;
}

const PromptBarSource = forwardRef<HTMLSpanElement, PromptBarSourceProps>(
  ({ className, children, icon, onRemove, ...props }, ref) => (
    <span
      ref={ref}
      data-slot="prompt-bar-source"
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full bg-surface-inset pr-1 pl-2",
        "text-[12px] font-medium text-ink-2 [&_svg]:size-3.5",
        className,
      )}
      {...props}
    >
      {icon}
      <span className="max-w-40 truncate">{children}</span>
      {onRemove === undefined ? null : (
        <button
          type="button"
          aria-label="Remove source"
          onClick={onRemove}
          className="flex size-4 items-center justify-center rounded-full text-ink-3 hover:bg-hover hover:text-ink"
        >
          <svg
            aria-hidden
            width="9"
            height="9"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </span>
  ),
);
PromptBarSource.displayName = "PromptBarSource";

export interface PromptBarFieldProps extends Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "onSubmit" | "value"
> {
  /** A draft is text — typed here rather than narrowed at render. */
  value?: string;
  /** Enter without a modifier. Never fires on an empty draft. */
  onSend?: () => void;
}

const PromptBarField = forwardRef<HTMLTextAreaElement, PromptBarFieldProps>(
  ({ className, onSend, onKeyDown, value, rows = 1, ...props }, ref) => (
    <textarea
      ref={ref}
      rows={rows}
      value={value}
      data-slot="prompt-bar-field"
      className={cn(
        "w-full resize-none bg-transparent px-3 py-2.5 text-[13.5px] text-ink outline-none",
        "placeholder:text-ink-3",
        className,
      )}
      onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        if (event.key !== "Enter" || event.shiftKey) return;
        if ((value ?? "").trim().length === 0) return;
        event.preventDefault();
        onSend?.();
      }}
      {...props}
    />
  ),
);
PromptBarField.displayName = "PromptBarField";

const PromptBarToolbar = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="prompt-bar-toolbar"
      className={cn("flex items-center gap-1 px-2 pb-2", className)}
      {...props}
    />
  ),
);
PromptBarToolbar.displayName = "PromptBarToolbar";

export interface PromptBarActionProps extends HTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  label?: string;
}

const PromptBarAction = forwardRef<HTMLButtonElement, PromptBarActionProps>(
  ({ className, children, active = false, label, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-pressed={active ? true : undefined}
      data-slot="prompt-bar-action"
      className={cn(
        "flex h-7 items-center gap-1.5 rounded-lg px-1.5 text-[12.5px] font-medium",
        "transition-colors duration-100 [&_svg]:size-4 [&_svg]:shrink-0",
        active ? "bg-surface-inset text-ink" : "text-ink-2 hover:bg-hover hover:text-ink",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  ),
);
PromptBarAction.displayName = "PromptBarAction";

const PromptBarSend = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ className, disabled, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      aria-label="Send"
      disabled={disabled}
      data-slot="prompt-bar-send"
      className={cn(
        "ml-auto flex size-7 shrink-0 items-center justify-center rounded-full transition-colors duration-100",
        disabled === true
          ? "bg-surface-inset text-ink-3 opacity-60"
          : "bg-primary text-primary-foreground",
        className,
      )}
      {...props}
    >
      <svg
        aria-hidden
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 19V5M5 12l7-7 7 7" />
      </svg>
    </button>
  ),
);
PromptBarSend.displayName = "PromptBarSend";

/** The @ / slash popup. Anchored by the caller — this is the surface, not a
 *  positioning engine; the app already has one in `components/popover`. */
const PromptBarMenu = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => (
    <div
      ref={ref}
      role="listbox"
      data-slot="prompt-bar-menu"
      className={cn(
        "w-64 overflow-hidden rounded-xl bg-surface-raised p-1 shadow-surface-3",
        "animate-in fade-in slide-in-from-bottom-1 duration-150 motion-reduce:animate-none",
        className,
      )}
      {...props}
    >
      <GlideList className="flex flex-col gap-px" highlightClassName="inset-x-0 rounded-md">
        {children}
      </GlideList>
    </div>
  ),
);
PromptBarMenu.displayName = "PromptBarMenu";

export interface PromptBarMenuItemProps extends HTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode;
  /** Trailing hint — a shortcut, or what the source is. */
  meta?: ReactNode;
  selected?: boolean;
}

const PromptBarMenuItem = forwardRef<HTMLButtonElement, PromptBarMenuItemProps>(
  ({ className, children, icon, meta, selected = false, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      role="option"
      aria-selected={selected}
      data-menu-row
      data-slot="prompt-bar-menu-item"
      className={cn(
        "relative z-10 flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-ink",
        "outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring)]",
        "[&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-ink-3",
        className,
      )}
      {...props}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {meta === undefined ? null : (
        <span className="shrink-0 text-[11.5px] text-ink-3">{meta}</span>
      )}
    </button>
  ),
);
PromptBarMenuItem.displayName = "PromptBarMenuItem";

export {
  PromptBar,
  PromptBarSources,
  PromptBarSource,
  PromptBarField,
  PromptBarToolbar,
  PromptBarAction,
  PromptBarSend,
  PromptBarMenu,
  PromptBarMenuItem,
  promptBarVariants,
};
