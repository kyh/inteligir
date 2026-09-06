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
import { cn } from "cn";

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

// text-white on the done fill: the palette has no success-foreground token
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
      capsules: "gap-2",
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

type TaskListProps = HTMLAttributes<HTMLDivElement> & VariantProps<typeof taskListVariants>;

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

type TaskItemProps = HTMLAttributes<HTMLDivElement>;

const TaskItem = forwardRef<HTMLDivElement, TaskItemProps>(
  ({ className, children, ...props }, ref) => {
    const { list } = useContext(TaskListContext);
    const [open, setOpen] = useState(false);
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

// onClick is omitted: a forwarded one would replace the toggle while aria-expanded still promised it
interface TaskItemRowProps extends Omit<HTMLAttributes<HTMLButtonElement>, "onSelect" | "onClick"> {
  status: TaskStatus;
  ordinal?: number;
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
    // layout-timed so the chevron agrees with the row before first paint; a render-phase write to the parent's state is illegal
    useLayoutEffect(() => {
      setExpandable(true);
      return () => setExpandable(false);
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

interface TaskDetailProps extends HTMLAttributes<HTMLDivElement> {
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
};
