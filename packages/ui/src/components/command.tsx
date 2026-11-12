"use client";
// Vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism), MIT.

// The palette's skin over Base UI's Autocomplete, as its command palette is built
// (base-ui.com/react/components/autocomplete): the list renders inline in a Dialog, always open,
// with a row always highlighted, so the field keeps focus while the arrows move the highlight and
// Enter runs the lit row's `onClick`; Base UI owns the combobox and listbox roles, the active
// descendant and the keys. The rows are the page's data, grouped, handed to the Root and drawn by
// the page through these parts; nothing filters them here, since a page's rows are already what its
// query found.

import { Autocomplete } from "@base-ui/react/autocomplete";
import { SearchIcon } from "lucide-react";
import { createContext, useContext, useState } from "react";
import type { ComponentProps, ReactNode, RefObject } from "react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@repo/ui/components/dialog";
import { cn } from "@repo/ui/lib/cn";
import { radius } from "@repo/ui/lib/radius";

// a row the palette lists
export interface CommandRow {
  // unique in the palette
  readonly value: string;
  // the row's words, as the field would spell them
  readonly label: string;
  // what the footer names Enter while this row is lit; without it Enter goes unnamed
  readonly action?: string | undefined;
  readonly onSelect: () => void;
}

// a heading over its rows: Base UI's grouped `items` take any group whose `items` are its rows
export interface CommandRowGroup<Row extends CommandRow = CommandRow> {
  readonly heading: string;
  readonly items: readonly Row[];
}

// Opens where a panel at its cap height sits centered, and keeps that top edge, so the field stays
// put while the rows under it change. Below 580px of window height the cap is 76dvh and the top
// lands on 12dvh.
const PANEL_PLACEMENT =
  "top-[max(12dvh,calc(50dvh-220px))] flex max-h-[min(440px,76dvh)] w-[calc(100%-2rem)] max-w-[560px] translate-y-0 flex-col overflow-hidden p-0";

// rounded-none: the global :focus-visible rule hands a focused element the shape radius, and a
// text input clips its caret to its corners
const FIELD_CLASSES =
  "min-w-0 flex-1 rounded-none bg-transparent font-[inherit] text-subtitle text-foreground outline-none placeholder:text-muted-foreground";

// what Enter does with the row Base UI has lit, for the footer
const LitActionContext = createContext<string | undefined>(undefined);

interface CommandDialogProps<Row extends CommandRow> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  // what the field holds, which the page searches by
  query: string;
  onQueryChange: (query: string) => void;
  // every row the parts below draw, in the order they draw them
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
  // the sr-only title and description sit inside the content: Base UI puts them inside the Popup,
  // and as siblings they would render while the palette is closed
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
          // the page's rows are what its query found, so nothing filters them or fills the field
          mode="none"
          items={groups}
          itemToStringValue={(row) => row.label}
          value={query}
          onValueChange={(next, details) => {
            // a picked row runs its verb; it never becomes the query
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
  // the row it draws, which Base UI holds as the item's value
  row: CommandRow;
  className?: string;
}

// the control height is fixed so a trimmed label cannot shrink the row, and shrink-0 because the
// list is a flex column
const CommandItem = ({ row, className, children, ...props }: CommandItemProps) => (
  <Autocomplete.Item
    value={row}
    // Base UI runs it for a click and for Enter on the lit row
    onClick={() => {
      row.onSelect();
    }}
    data-slot="command-item"
    className={cn(
      "relative flex h-7 shrink-0 cursor-pointer items-center gap-1 px-1.5 text-body outline-none select-none",
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

// one box per key; a chord can repeat a cap, so the position is part of the key
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
  // one entry per key, as `hotkeyCaps` (`@repo/ui/lib/hotkey-spelling`) draws it for this keyboard
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

// the Enter hint names the lit row, so it reads as the thing Enter does rather than a generic
// "Run", and sits at the trailing edge so its changing width never moves the other hints
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
};
