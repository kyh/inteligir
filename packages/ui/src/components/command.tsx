"use client";
// @license MIT, vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism).

import { Autocomplete } from "@base-ui/react/autocomplete";
import { SearchMd as SearchIcon } from "@untitledui/icons";
import { createContext, useContext, useState } from "react";
import type { ComponentProps, ReactNode, RefObject } from "react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@repo/ui/components/dialog";
import { cn } from "@repo/ui/lib/cn";
import { radius } from "@repo/ui/lib/radius";

export interface CommandRow {
  readonly value: string;
  readonly label: string;
  readonly action?: string | undefined;
  readonly onSelect: () => void;
}

export interface CommandRowGroup<Row extends CommandRow = CommandRow> {
  readonly heading: string;
  readonly items: readonly Row[];
}

const PANEL_PLACEMENT =
  "top-[max(12dvh,calc(50dvh-220px))] flex max-h-[min(440px,76dvh)] w-[calc(100%-2rem)] max-w-[560px] translate-y-0 flex-col overflow-hidden p-0";

const FIELD_CLASSES =
  "min-w-0 flex-1 rounded-none bg-transparent font-[inherit] text-subtitle text-foreground outline-none placeholder:text-muted-foreground";

const LitActionContext = createContext<string | undefined>(undefined);

interface CommandDialogProps<Row extends CommandRow> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  query: string;
  onQueryChange: (query: string) => void;
  groups: readonly CommandRowGroup<Row>[];
  className?: string;
  initialFocus?: RefObject<HTMLElement | null>;
  children: ReactNode;
}

const CommandDialog = <Row extends CommandRow>({
  open,
  onOpenChange,
  title,
  description,
  query,
  onQueryChange,
  groups,
  className,
  initialFocus,
  children,
}: CommandDialogProps<Row>) => {
  const [litAction, setLitAction] = useState<string | undefined>();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        initialFocus={initialFocus}
        className={cn(PANEL_PLACEMENT, className)}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">{description}</DialogDescription>
        <Autocomplete.Root
          inline
          open
          autoHighlight="always"
          keepHighlight
          mode="none"
          items={groups}
          itemToStringValue={(row) => row.label}
          value={query}
          onValueChange={(next, details) => {
            if (details.reason !== "item-press") {
              onQueryChange(next);
            }
          }}
          onItemHighlighted={(row) => {
            setLitAction(row?.action);
          }}
        >
          <LitActionContext value={litAction}>{children}</LitActionContext>
        </Autocomplete.Root>
      </DialogContent>
    </Dialog>
  );
};

type CommandInputProps = Omit<
  ComponentProps<typeof Autocomplete.Input>,
  "className" | "value" | "onChange"
> & { className?: string };

const CommandInput = ({ className, ...props }: CommandInputProps) => (
  <Autocomplete.InputGroup
    data-slot="command-input"
    className="group/command-input flex h-10 shrink-0 items-center gap-2 px-3"
  >
    <SearchIcon
      aria-hidden
      size={14}
      strokeWidth={1.5}
      className="shrink-0 text-muted-foreground transition-[color,stroke-width] duration-80 group-focus-within/command-input:stroke-2 group-focus-within/command-input:text-foreground"
    />
    <Autocomplete.Input
      autoCorrect="off"
      spellCheck={false}
      className={cn(FIELD_CLASSES, className)}
      {...props}
    />
  </Autocomplete.InputGroup>
);

const CommandStatus = ({ children }: { children: ReactNode }) => (
  <Autocomplete.Status
    data-slot="command-status"
    className="shrink-0 px-3 text-caption text-muted-foreground not-empty:pb-2"
  >
    {children}
  </Autocomplete.Status>
);

const CommandList = ({ className, children }: { className?: string; children: ReactNode }) => (
  <Autocomplete.List
    data-slot="command-list"
    className={cn(
      "relative flex max-h-72 min-h-0 flex-1 scroll-py-1 flex-col gap-0.5 overflow-x-hidden overflow-y-auto border-t border-border/60 p-1 outline-none data-[empty]:p-0",
      className,
    )}
  >
    {children}
  </Autocomplete.List>
);

const CommandGroup = ({
  heading,
  className,
  children,
}: {
  heading: string;
  className?: string;
  children: ReactNode;
}) => (
  <Autocomplete.Group data-slot="command-group" className={cn("flex flex-col", className)}>
    <Autocomplete.GroupLabel className="flex h-6 shrink-0 items-center truncate px-1.5 text-caption text-muted-foreground">
      {heading}
    </Autocomplete.GroupLabel>
    {children}
  </Autocomplete.Group>
);

interface CommandItemProps extends Omit<
  ComponentProps<typeof Autocomplete.Item>,
  "className" | "value" | "onClick"
> {
  row: CommandRow;
  className?: string;
}

const CommandItem = ({ row, className, children, ...props }: CommandItemProps) => (
  <Autocomplete.Item
    value={row}
    onClick={() => {
      row.onSelect();
    }}
    data-slot="command-item"
    className={cn(
      "relative flex h-9 shrink-0 cursor-pointer items-center gap-2 px-2 text-body outline-none select-none",
      radius.item,
      "text-muted-foreground transition-colors duration-80 data-[highlighted]:bg-hover data-[highlighted]:text-foreground",
      "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
      className,
    )}
    {...props}
  >
    {children}
  </Autocomplete.Item>
);

const Caps = ({ caps }: { caps: readonly string[] }) => (
  <>
    {caps.map((cap, index) => (
      <span
        key={`${cap}-${String(index)}`}
        className="flex h-4 min-w-4 items-center justify-center rounded-[5px] bg-hover px-1 text-caption text-muted-foreground"
      >
        {cap}
      </span>
    ))}
  </>
);

interface CommandShortcutProps extends Omit<ComponentProps<"kbd">, "children"> {
  caps: readonly string[];
}

const CommandShortcut = ({ className, caps, ...props }: CommandShortcutProps) => (
  <kbd
    data-slot="command-shortcut"
    className={cn(
      "ml-auto inline-flex shrink-0 items-center gap-0.5 align-middle font-sans",
      className,
    )}
    {...props}
  >
    <Caps caps={caps} />
  </kbd>
);

const HINTS: readonly { label: string; caps: readonly string[] }[] = [
  { caps: ["↑", "↓"], label: "Select" },
  { caps: ["Esc"], label: "Close" },
];

const CommandFooter = ({ className, ...props }: ComponentProps<"div">) => {
  const action = useContext(LitActionContext);

  return (
    <div
      data-slot="command-footer"
      className={cn(
        "flex h-8 shrink-0 items-center gap-3 px-3 text-caption text-muted-foreground",
        className,
      )}
      {...props}
    >
      {HINTS.map((hint) => (
        <span key={hint.label} className="flex shrink-0 items-center gap-1.5">
          <span>{hint.label}</span>
          <kbd className="inline-flex shrink-0 items-center gap-0.5 align-middle font-sans">
            <Caps caps={hint.caps} />
          </kbd>
        </span>
      ))}
      {action === undefined ? null : (
        <span className="ml-auto flex min-w-0 items-center gap-1.5 text-foreground">
          <span className="truncate">{action}</span>
          <kbd className="inline-flex shrink-0 items-center gap-0.5 align-middle font-sans">
            <Caps caps={["↵"]} />
          </kbd>
        </span>
      )}
    </div>
  );
};

export {
  CommandDialog,
  CommandFooter,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
  CommandStatus,
};
