// ---------------------------------------------------------------------------
// json-render component registry for widget panels. Each implementation maps a
// catalog component onto a shadcn (@repo/ui) primitive so widgets match the
// rest of the app. Components emit events ("press", "change") which the
// renderer resolves against each element's `on` field.
// ---------------------------------------------------------------------------

import { Children } from "react";
import { defineRegistry, useStateStore } from "@json-render/react";
import { Avatar, AvatarFallback, AvatarImage } from "@repo/ui/components/avatar";
import { Badge } from "@repo/ui/components/badge";
import { Button, buttonVariants } from "@repo/ui/components/button";
import { Checkbox } from "@repo/ui/components/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@repo/ui/components/collapsible";
import {
  DataChart,
  type DataChartSeries,
  type DataChartType,
} from "@repo/ui/components/data-chart";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@repo/ui/components/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@repo/ui/components/drawer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@repo/ui/components/dropdown-menu";
import { Input as UiInput } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui/components/popover";
import { RadioGroup, RadioGroupItem } from "@repo/ui/components/radio-group";
import { Response } from "@repo/ui/components/ai-elements/response";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import { Separator } from "@repo/ui/components/separator";
import { Slider, type SliderValue } from "@repo/ui/components/slider";
import { Spinner } from "@repo/ui/components/spinner";
import { Switch } from "@repo/ui/components/switch";
import { TabItem, TabPanel, Tabs, TabsList } from "@repo/ui/components/tabs";
import {
  Table as UiTable,
  TableBody as UiTableBody,
  TableCaption,
  TableCell as UiTableCell,
  TableHead as UiTableHead,
  TableHeader as UiTableHeader,
  TableRow as UiTableRow,
} from "@repo/ui/components/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@repo/ui/components/tooltip";
import { cn } from "@repo/ui/lib/utils";
import { ChevronDownIcon } from "lucide-react";

import { widgetCatalog } from "@/renderer/shell/widget-catalog";

type BaseProps<P> = {
  props: P;
  children?: React.ReactNode;
  emit: (event: string) => void;
  bindings?: Record<string, string>;
};

const gapClass = (gap?: "sm" | "md" | "lg") =>
  gap === "sm" ? "gap-2" : gap === "md" ? "gap-3" : "gap-4";

function Stack({ props, children }: BaseProps<{ gap?: "sm" | "md" | "lg" }>) {
  return <div className={cn("flex flex-col", gapClass(props.gap))}>{children}</div>;
}

function Grid({
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

function Section({ props, children }: BaseProps<{ title?: string }>) {
  return (
    <div className="flex flex-col gap-2">
      {props.title ? (
        <Label className="text-xs font-medium text-muted-foreground">{props.title}</Label>
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

function Row({ props, emit, children }: BaseProps<{ bordered?: boolean }>) {
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
        bordered && "rounded-md border border-border px-3 py-2",
      )}
    >
      {children}
    </div>
  );
}

const headingClass = {
  "1": "text-base font-semibold",
  "2": "text-sm font-semibold",
  "3": "text-xs font-medium text-muted-foreground",
};

function Heading({ props }: BaseProps<{ text: string; level?: "1" | "2" | "3" }>) {
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

function Text({
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

function TextBlock({ props }: BaseProps<{ title: string; description?: string }>) {
  return (
    <span className="flex flex-col">
      <span className="text-xs text-foreground">{props.title}</span>
      {props.description ? (
        <span className="text-[10px] text-muted-foreground">{props.description}</span>
      ) : null}
    </span>
  );
}

function CatalogButton({
  props,
  emit,
}: BaseProps<{
  label: string;
  variant?: "default" | "outline" | "ghost" | "secondary" | "destructive";
  size?: "xs" | "sm" | "default" | "lg";
  disabled?: boolean;
}>) {
  return (
    <Button
      variant={props.variant ?? "ghost"}
      size={props.size ?? "sm"}
      disabled={props.disabled === true}
      onClick={() => emit("press")}
    >
      {props.label}
    </Button>
  );
}

function CatalogCheckbox({
  props,
  emit,
  bindings,
}: BaseProps<{
  label: string;
  description?: string;
  checked?: boolean;
  disabled?: boolean;
}>) {
  const store = useStateStore();
  const bindPath = bindings?.["checked"];
  const checked = props.checked === true;
  const handleChange = (next: boolean) => {
    if (bindPath) store.set(bindPath, next);
    emit("change");
  };
  return (
    <label className="flex cursor-pointer items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
      <span className="flex flex-col">
        <span className="text-xs text-foreground">{props.label}</span>
        {props.description ? (
          <span className="text-[10px] text-muted-foreground">{props.description}</span>
        ) : null}
      </span>
      <Checkbox
        checked={checked}
        onCheckedChange={(value) => handleChange(value === true)}
        disabled={props.disabled === true}
      />
    </label>
  );
}

// Shared two-way-bind handler for the text field components: write the new
// value to the bound state path (if any) and emit the change event.
function useBoundTextChange(
  bindings: Record<string, string> | undefined,
  emit: (event: string) => void,
) {
  const store = useStateStore();
  const bindPath = bindings?.["value"];
  return (next: string) => {
    if (bindPath) store.set(bindPath, next);
    emit("change");
  };
}

function CatalogInput({
  props,
  emit,
  bindings,
}: BaseProps<{
  label?: string;
  placeholder?: string;
  value?: string;
  disabled?: boolean;
}>) {
  const onValueChange = useBoundTextChange(bindings, emit);
  return (
    <label className="flex flex-col gap-1">
      {props.label ? (
        <span className="text-[10px] font-medium text-muted-foreground">{props.label}</span>
      ) : null}
      <UiInput
        value={props.value ?? ""}
        placeholder={props.placeholder}
        disabled={props.disabled === true}
        onChange={(e) => onValueChange(e.currentTarget.value)}
      />
    </label>
  );
}

function CatalogTextarea({
  props,
  emit,
  bindings,
}: BaseProps<{
  label?: string;
  placeholder?: string;
  value?: string;
  rows?: number;
  disabled?: boolean;
}>) {
  const onValueChange = useBoundTextChange(bindings, emit);
  return (
    <label className="flex flex-col gap-1">
      {props.label ? (
        <span className="text-[10px] font-medium text-muted-foreground">{props.label}</span>
      ) : null}
      <textarea
        className="min-h-20 w-full resize-y rounded-md border border-border bg-transparent px-2 py-1 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
        value={props.value ?? ""}
        placeholder={props.placeholder}
        rows={props.rows ?? 4}
        disabled={props.disabled === true}
        onChange={(e) => onValueChange(e.currentTarget.value)}
      />
    </label>
  );
}

function CatalogCard({ children }: BaseProps<Record<string, never>>) {
  return <div className="rounded-md border border-border p-3">{children}</div>;
}

function CatalogSeparator() {
  return <Separator />;
}

function CatalogMarkdown({ props }: BaseProps<{ content?: string }>) {
  return (
    <div className="text-xs leading-relaxed text-foreground">
      <Response>{props.content ?? ""}</Response>
    </div>
  );
}

function CatalogBadge({
  props,
}: BaseProps<{
  text: string;
  variant?: "default" | "secondary" | "destructive" | "outline" | "ghost";
}>) {
  return <Badge variant={props.variant ?? "default"}>{props.text}</Badge>;
}

function CatalogSwitch({
  props,
  emit,
  bindings,
}: BaseProps<{
  label: string;
  description?: string;
  checked?: boolean;
  disabled?: boolean;
}>) {
  const store = useStateStore();
  const bindPath = bindings?.["checked"];
  const checked = props.checked === true;
  const handleToggle = () => {
    if (bindPath) store.set(bindPath, !checked);
    emit("change");
  };
  return (
    // Stop propagation so toggling the switch inside a Row doesn't also fire the
    // row's `press` action (Row's interactive-child guard doesn't cover this).
    <div
      className="flex items-center justify-between gap-2 rounded-md border border-border py-1 pr-1 pl-3"
      onClick={(e) => e.stopPropagation()}
    >
      <span className="flex flex-col">
        <span className="text-xs text-foreground">{props.label}</span>
        {props.description ? (
          <span className="text-[10px] text-muted-foreground">{props.description}</span>
        ) : null}
      </span>
      <Switch
        label=""
        checked={checked}
        onToggle={handleToggle}
        disabled={props.disabled === true}
      />
    </div>
  );
}

type CatalogOption = { label: string; value: string };

function CatalogSelect({
  props,
  emit,
  bindings,
}: BaseProps<{
  label?: string;
  placeholder?: string;
  value?: string;
  options?: CatalogOption[];
  disabled?: boolean;
}>) {
  const store = useStateStore();
  const bindPath = bindings?.["value"];
  const options = props.options ?? [];
  const handleChange = (next: string | null) => {
    if (bindPath) store.set(bindPath, next ?? "");
    emit("change");
  };
  return (
    <div className="flex flex-col gap-1">
      {props.label ? (
        <span className="text-[10px] font-medium text-muted-foreground">{props.label}</span>
      ) : null}
      <Select
        items={options}
        value={props.value ?? ""}
        onValueChange={(value) => handleChange(value as string | null)}
        disabled={props.disabled === true}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder={props.placeholder ?? "Select…"} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function CatalogRadioGroup({
  props,
  emit,
  bindings,
}: BaseProps<{
  label?: string;
  value?: string;
  options?: Array<CatalogOption & { description?: string }>;
  disabled?: boolean;
}>) {
  const store = useStateStore();
  const bindPath = bindings?.["value"];
  const options = props.options ?? [];
  const handleChange = (next: unknown) => {
    if (bindPath) store.set(bindPath, typeof next === "string" ? next : "");
    emit("change");
  };
  return (
    <div className="flex flex-col gap-2">
      {props.label ? (
        <span className="text-[10px] font-medium text-muted-foreground">{props.label}</span>
      ) : null}
      <RadioGroup
        value={props.value ?? ""}
        onValueChange={(value) => handleChange(value)}
        disabled={props.disabled === true}
      >
        {options.map((option) => (
          <label key={option.value} className="flex cursor-pointer items-start gap-2">
            <RadioGroupItem value={option.value} className="mt-0.5" />
            <span className="flex flex-col">
              <span className="text-xs text-foreground">{option.label}</span>
              {option.description ? (
                <span className="text-[10px] text-muted-foreground">{option.description}</span>
              ) : null}
            </span>
          </label>
        ))}
      </RadioGroup>
    </div>
  );
}

function CatalogSlider({
  props,
  emit,
  bindings,
}: BaseProps<{
  label?: string;
  value?: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}>) {
  const store = useStateStore();
  const bindPath = bindings?.["value"];
  const min = props.min ?? 0;
  const max = props.max ?? 100;
  const value = typeof props.value === "number" ? props.value : min;
  const handleChange = (next: SliderValue) => {
    const numeric = Array.isArray(next) ? next[0] : next;
    if (bindPath) store.set(bindPath, numeric);
    emit("change");
  };
  return (
    // Stop propagation so dragging/clicking the slider inside a Row doesn't also
    // fire the row's `press` action.
    <div
      className="flex flex-col gap-1 px-1"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <Slider
        label={props.label}
        value={value}
        onChange={handleChange}
        min={min}
        max={max}
        step={props.step ?? 1}
        disabled={props.disabled === true}
      />
    </div>
  );
}

const avatarSizeMap = { sm: 24, default: 32, lg: 40 } as const;

function CatalogAvatar({
  props,
}: BaseProps<{ src?: string; fallback?: string; size?: "sm" | "default" | "lg" }>) {
  const fallback = props.fallback?.slice(0, 2) || "?";
  return (
    <Avatar size={props.size ?? "default"}>
      {props.src ? <AvatarImage src={props.src} alt={props.fallback ?? ""} /> : null}
      <AvatarFallback>{fallback}</AvatarFallback>
    </Avatar>
  );
}

function CatalogSpinner({ props }: BaseProps<{ size?: "sm" | "default" | "lg" }>) {
  const size = avatarSizeMap[props.size ?? "default"] * 0.7;
  return <Spinner width={size} height={size} className="text-muted-foreground" />;
}

function CatalogChart({
  props,
}: BaseProps<{
  type?: DataChartType;
  data?: Array<Record<string, unknown>>;
  series?: DataChartSeries[];
  categoryKey?: string;
  height?: number;
  stacked?: boolean;
  showLegend?: boolean;
  showGrid?: boolean;
}>) {
  return (
    <DataChart
      type={props.type}
      data={props.data}
      series={props.series}
      categoryKey={props.categoryKey}
      height={props.height}
      stacked={props.stacked}
      showLegend={props.showLegend}
      showGrid={props.showGrid}
    />
  );
}

function CatalogImage({
  props,
}: BaseProps<{ src: string; alt?: string; rounded?: boolean }>) {
  return (
    // Electron renderer — next/image does not apply here.
    // oxlint-disable-next-line next/no-img-element
    <img
      src={props.src}
      alt={props.alt ?? ""}
      className={cn("max-w-full object-cover", props.rounded === true && "rounded-md")}
    />
  );
}

function CatalogCollapsible({
  props,
  children,
}: BaseProps<{ title: string; defaultOpen?: boolean }>) {
  return (
    <Collapsible
      defaultOpen={props.defaultOpen === true}
      className="rounded-md border border-border"
    >
      <CollapsibleTrigger className="group flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium text-foreground">
        {props.title}
        <ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-data-[panel-open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-2 px-3 pb-3">{children}</CollapsibleContent>
    </Collapsible>
  );
}

function CatalogTabs({ props, children }: BaseProps<{ tabs?: CatalogOption[] }>) {
  const tabs = props.tabs ?? [];
  if (tabs.length === 0) return null;
  // Panels pair with tabs by position: panel[i] is the panel for tab[i]. The
  // catalog contract is one child per tab with no per-child `visible` (the Tabs
  // owns panel visibility) — that keeps this positional pairing aligned, since a
  // child filtered out by a `visible` condition would otherwise shift the rest.
  const panels = Children.toArray(children);
  return (
    <Tabs defaultValue={tabs[0]?.value}>
      <TabsList>
        {tabs.map((tab) => (
          <TabItem key={tab.value} value={tab.value} label={tab.label} />
        ))}
      </TabsList>
      {tabs.map((tab, index) => (
        <TabPanel key={tab.value} value={tab.value} className="pt-3">
          {panels[index] ?? null}
        </TabPanel>
      ))}
    </Tabs>
  );
}

function CatalogTable({ props, children }: BaseProps<{ caption?: string }>) {
  return (
    <UiTable>
      {props.caption ? <TableCaption>{props.caption}</TableCaption> : null}
      {children}
    </UiTable>
  );
}

function CatalogTableHeader({ children }: BaseProps<Record<string, never>>) {
  return <UiTableHeader>{children}</UiTableHeader>;
}

function CatalogTableBody({ children }: BaseProps<Record<string, never>>) {
  return <UiTableBody>{children}</UiTableBody>;
}

function CatalogTableRow({ children }: BaseProps<Record<string, never>>) {
  return <UiTableRow>{children}</UiTableRow>;
}

function CatalogTableHead({ props }: BaseProps<{ text: string }>) {
  return <UiTableHead>{props.text}</UiTableHead>;
}

function CatalogTableCell({ props, children }: BaseProps<{ text?: string }>) {
  return <UiTableCell>{props.text != null ? props.text : children}</UiTableCell>;
}

// Overlays render their content in a portal. Each takes a `trigger` label that
// styles the built-in trigger button (via buttonVariants on the native button —
// not the `render` prop, which the wrapper types don't surface); the children
// are the overlay body. Built-in affordances (✕ / Escape / outside-click /
// hover-out) handle closing — overlays are uncontrolled, so an action inside
// them does not auto-close.
const overlayTriggerClass = buttonVariants({ variant: "outline", size: "sm" });

function CatalogDialog({
  props,
  children,
}: BaseProps<{ trigger: string; title?: string; description?: string }>) {
  return (
    <Dialog>
      <DialogTrigger className={overlayTriggerClass}>{props.trigger}</DialogTrigger>
      <DialogContent>
        {props.title || props.description ? (
          <DialogHeader>
            {props.title ? <DialogTitle>{props.title}</DialogTitle> : null}
            {props.description ? <DialogDescription>{props.description}</DialogDescription> : null}
          </DialogHeader>
        ) : null}
        {children}
      </DialogContent>
    </Dialog>
  );
}

function CatalogDrawer({
  props,
  children,
}: BaseProps<{
  trigger: string;
  title?: string;
  description?: string;
  side?: "top" | "bottom" | "left" | "right";
}>) {
  return (
    <Drawer direction={props.side ?? "right"}>
      <DrawerTrigger className={overlayTriggerClass}>{props.trigger}</DrawerTrigger>
      <DrawerContent>
        {props.title || props.description ? (
          <DrawerHeader>
            {props.title ? <DrawerTitle>{props.title}</DrawerTitle> : null}
            {props.description ? <DrawerDescription>{props.description}</DrawerDescription> : null}
          </DrawerHeader>
        ) : null}
        <div className="flex flex-col gap-2 p-4 pt-0">{children}</div>
      </DrawerContent>
    </Drawer>
  );
}

function CatalogPopover({ props, children }: BaseProps<{ trigger: string }>) {
  return (
    <Popover>
      <PopoverTrigger className={overlayTriggerClass}>{props.trigger}</PopoverTrigger>
      <PopoverContent>{children}</PopoverContent>
    </Popover>
  );
}

function CatalogTooltip({ props, children }: BaseProps<{ text: string }>) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger className="inline-flex w-fit cursor-help">{children}</TooltipTrigger>
        <TooltipContent>{props.text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function CatalogDropdownMenu({ props, children }: BaseProps<{ trigger: string }>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={overlayTriggerClass}>{props.trigger}</DropdownMenuTrigger>
      <DropdownMenuContent>{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}

function CatalogMenuItem({
  props,
  emit,
}: BaseProps<{ label: string; variant?: "default" | "destructive"; disabled?: boolean }>) {
  return (
    <DropdownMenuItem
      variant={props.variant ?? "default"}
      disabled={props.disabled === true}
      onClick={() => emit("press")}
    >
      {props.label}
    </DropdownMenuItem>
  );
}

export const { registry: widgetRegistry } = defineRegistry(widgetCatalog, {
  components: {
    Stack,
    Section,
    Row,
    Grid,
    Heading,
    Text,
    TextBlock,
    Markdown: CatalogMarkdown,
    Badge: CatalogBadge,
    Button: CatalogButton,
    Checkbox: CatalogCheckbox,
    Switch: CatalogSwitch,
    Input: CatalogInput,
    Textarea: CatalogTextarea,
    Select: CatalogSelect,
    RadioGroup: CatalogRadioGroup,
    Slider: CatalogSlider,
    Avatar: CatalogAvatar,
    Spinner: CatalogSpinner,
    Image: CatalogImage,
    Chart: CatalogChart,
    Card: CatalogCard,
    Collapsible: CatalogCollapsible,
    Tabs: CatalogTabs,
    Table: CatalogTable,
    TableHeader: CatalogTableHeader,
    TableBody: CatalogTableBody,
    TableRow: CatalogTableRow,
    TableHead: CatalogTableHead,
    TableCell: CatalogTableCell,
    Dialog: CatalogDialog,
    Drawer: CatalogDrawer,
    Popover: CatalogPopover,
    Tooltip: CatalogTooltip,
    DropdownMenu: CatalogDropdownMenu,
    MenuItem: CatalogMenuItem,
    Separator: CatalogSeparator,
  },
  // Action stubs — real handlers are mounted per-viewer in widget-viewer.tsx
  // so they can close over the bridge, store, and toast singleton.
  actions: {
    notify: async () => {},
    openUrl: async () => {},
    sendPrompt: async () => {},
    generateText: async () => {},
    fetchUrl: async () => {},
    callTool: async () => {},
  },
});
