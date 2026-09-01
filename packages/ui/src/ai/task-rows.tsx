"use client";
// Vendored from Beautiful UI (beautifului.dev), MIT.

import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { Collapse } from "@repo/ui/lib/collapse";
import { cn } from "@repo/ui/lib/utils";

/* ─────────────────────────────────────────────────────────
 * TASK ROWS — live status for a list of agent tasks
 *
 * A badge carries the state (numbered ring while working, a
 * check or cross once settled), the row carries the label and
 * a count, and each row expands to its own detail lines.
 *
 * Upstream walks a fixture through a canned tick sequence and
 * hardcodes its own status vocabulary. Here ROWS ARE THE INPUT
 * and `status` is the whole vocabulary, so the caller's own
 * lifecycle names map onto four visual states and stay the
 * source of truth. The status PILL is a slot for the same
 * reason: its wording belongs to the caller, not to this card.
 * ───────────────────────────────────────────────────────── */

export type TaskStatus = "pending" | "running" | "done" | "failed";

function SpinnerRing({ active, children }: { active: boolean; children: ReactNode }) {
  const size = 24;
  const stroke = 2;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg
        aria-hidden
        width={size}
        height={size}
        className={cn("absolute inset-0", active && "animate-spin")}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--line)"
          strokeWidth={stroke}
        />
        {active ? (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--ink-3)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${String(circumference * 0.28)} ${String(circumference * 0.72)}`}
          />
        ) : null}
      </svg>
      <span className="relative text-[10.5px] font-semibold tabular-nums text-ink">{children}</span>
    </span>
  );
}

const CHECK_ICON = (
  <svg
    aria-hidden
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

const X_ICON = (
  <svg
    aria-hidden
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3.5"
    strokeLinecap="round"
  >
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);

/** The row's one splash of hue: settled states read at a glance in a list that
 *  is otherwise monochrome. `text-white` on the done fill is a contrast
 *  requirement — the palette has no success-foreground token to reach for. */
function StatusBadge({ status, ordinal }: { status: TaskStatus; ordinal: number }) {
  if (status === "done") {
    return (
      <span className="flex size-5.5 shrink-0 animate-in items-center justify-center rounded-full bg-emerald-500 text-white zoom-in-95">
        {CHECK_ICON}
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="flex size-5.5 shrink-0 animate-in items-center justify-center rounded-full bg-destructive text-destructive-foreground zoom-in-95">
        {X_ICON}
      </span>
    );
  }
  return <SpinnerRing active={status === "running"}>{ordinal}</SpinnerRing>;
}

const taskListVariants = cva("flex w-full flex-col", {
  variants: {
    variant: {
      /** Each row floats on its own card. */
      capsules: "gap-2",
      /** One bordered stack. */
      list: "gap-0 overflow-hidden rounded-xl bg-surface-raised shadow-surface-2",
    },
  },
  defaultVariants: { variant: "capsules" },
});

interface TaskListContextValue {
  list: boolean;
}

const TaskListContext = createContext<TaskListContextValue>({ list: false });

interface TaskItemContextValue {
  open: boolean;
  toggle: () => void;
  expandable: boolean;
  setExpandable: (expandable: boolean) => void;
}

const TaskItemContext = createContext<TaskItemContextValue | null>(null);

function useTaskItem(): TaskItemContextValue {
  const value = useContext(TaskItemContext);
  if (value === null) {
    throw new Error("TaskItem parts must render inside <TaskItem>");
  }
  return value;
}

export type TaskListProps = HTMLAttributes<HTMLDivElement> & VariantProps<typeof taskListVariants>;

const TaskList = forwardRef<HTMLDivElement, TaskListProps>(
  ({ variant, className, children, ...props }, ref) => {
    const context = useMemo(() => ({ list: variant === "list" }), [variant]);
    return (
      <TaskListContext.Provider value={context}>
        <div
          ref={ref}
          data-slot="task-list"
          className={cn(taskListVariants({ variant }), className)}
          {...props}
        >
          {children}
        </div>
      </TaskListContext.Provider>
    );
  },
);
TaskList.displayName = "TaskList";

export type TaskItemProps = HTMLAttributes<HTMLDivElement>;

const TaskItem = forwardRef<HTMLDivElement, TaskItemProps>(
  ({ className, children, ...props }, ref) => {
    const { list } = useContext(TaskListContext);
    const [open, setOpen] = useState(false);
    // A row learns it is expandable from its own details part rather than
    // from a prop the caller has to keep in sync with what it rendered.
    const [expandable, setExpandable] = useState(false);
    const toggle = useCallback(() => setOpen((value) => !value), []);
    const context = useMemo(
      () => ({ open, toggle, expandable, setExpandable }),
      [open, toggle, expandable],
    );
    return (
      <TaskItemContext.Provider value={context}>
        <div
          ref={ref}
          data-slot="task-item"
          className={cn(
            "animate-in fade-in slide-in-from-bottom-1 fill-mode-both self-stretch overflow-hidden transition-[border-radius,background-color] duration-300",
            list
              ? "border-b border-line last:border-0"
              : "rounded-[22px] bg-surface-raised shadow-surface-2 hover:bg-surface-inset",
            !list && open && "rounded-[14px]",
            className,
          )}
          {...props}
        >
          {children}
        </div>
      </TaskItemContext.Provider>
    );
  },
);
TaskItem.displayName = "TaskItem";

export interface TaskItemRowProps extends Omit<HTMLAttributes<HTMLButtonElement>, "onSelect"> {
  status: TaskStatus;
  /** Shown inside the badge while the row is unsettled. */
  ordinal?: number;
  /** Open this row's subject. Absent, the row toggles its own details. */
  onSelect?: () => void;
}

const TaskItemRow = forwardRef<HTMLButtonElement, TaskItemRowProps>(
  ({ status, ordinal = 1, onSelect, className, children, ...props }, ref) => {
    const { open, toggle, expandable } = useTaskItem();
    return (
      <button
        ref={ref}
        type="button"
        aria-expanded={expandable && onSelect === undefined ? open : undefined}
        disabled={!expandable && onSelect === undefined}
        onClick={onSelect ?? toggle}
        data-slot="task-item-row"
        className={cn("flex h-11 w-full items-center gap-2.5 px-2.5 text-left", className)}
        {...props}
      >
        <span className="flex size-6 shrink-0 items-center justify-center">
          <StatusBadge status={status} ordinal={ordinal} />
        </span>
        {children}
        {expandable && onSelect === undefined ? (
          <span
            aria-hidden
            className="-ml-2 flex size-7 shrink-0 items-center justify-center rounded-full text-ink-3"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={cn("transition-transform duration-300", open && "rotate-180")}
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </span>
        ) : null}
      </button>
    );
  },
);
TaskItemRow.displayName = "TaskItemRow";

const TaskItemLabel = forwardRef<HTMLSpanElement, HTMLAttributes<HTMLSpanElement>>(
  ({ className, children, ...props }, ref) => (
    <span
      ref={ref}
      data-slot="task-item-label"
      className={cn("min-w-0 flex-1 truncate text-[13px] font-medium text-ink", className)}
      {...props}
    >
      {children}
    </span>
  ),
);
TaskItemLabel.displayName = "TaskItemLabel";

/** The trailing word for a row. The CALLER owns the wording — this part only
 *  owns where it sits and how quiet it reads. */
const TaskStatusLabel = forwardRef<HTMLSpanElement, HTMLAttributes<HTMLSpanElement>>(
  ({ className, children, ...props }, ref) => (
    <span
      ref={ref}
      data-slot="task-status"
      className={cn("shrink-0 text-[12.5px] text-ink-2 tabular-nums", className)}
      {...props}
    >
      {children}
    </span>
  ),
);
TaskStatusLabel.displayName = "TaskStatusLabel";

const TaskItemDetails = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => {
    const { open, setExpandable } = useTaskItem();
    // Announce expandability from an effect: the flag is the parent TaskItem's
    // state, and a render-phase write to another component's store is illegal.
    // Layout-timed so the chevron agrees with the row before first paint.
    useLayoutEffect(() => {
      setExpandable(true);
    }, [setExpandable]);
    return (
      <Collapse open={open}>
        <div
          ref={ref}
          data-slot="task-item-details"
          className={cn("mb-2.5 grid grid-cols-[24px_1fr] gap-2.5 px-2.5", className)}
          {...props}
        >
          <span aria-hidden className="mx-auto h-full w-px bg-line" />
          <div className="flex flex-col gap-1.5">{children}</div>
        </div>
      </Collapse>
    );
  },
);
TaskItemDetails.displayName = "TaskItemDetails";

export interface TaskDetailProps extends HTMLAttributes<HTMLDivElement> {
  meta?: string;
}

const TaskDetail = forwardRef<HTMLDivElement, TaskDetailProps>(
  ({ meta, className, children, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="task-detail"
      className={cn("flex items-center justify-between gap-2", className)}
      {...props}
    >
      <span className="min-w-0 text-[12px] text-ink-2">{children}</span>
      {meta === undefined ? null : (
        <span className="shrink-0 font-mono text-[11.5px] text-ink-3 tabular-nums">{meta}</span>
      )}
    </div>
  ),
);
TaskDetail.displayName = "TaskDetail";

export {
  TaskList,
  TaskItem,
  TaskItemRow,
  TaskItemLabel,
  TaskStatusLabel,
  TaskItemDetails,
  TaskDetail,
  taskListVariants,
};
