// Non-interactive display + container components for the widget catalog.

import { Children } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@repo/ui/components/avatar";
import { Badge } from "@repo/ui/components/badge";
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
import { Response } from "@repo/ui/components/ai-elements/response";
import { Separator } from "@repo/ui/components/separator";
import { Spinner } from "@repo/ui/components/spinner";
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
import { cn } from "@repo/ui/lib/utils";
import { ChevronDownIcon } from "lucide-react";

import type { BaseProps, CatalogOption } from "@/renderer/shell/catalog/shared";

export function CatalogCard({ children }: BaseProps<Record<string, never>>) {
  return (
    <div className="object-row rounded-[16px] border border-[var(--object-row-border)] p-3.5">
      {children}
    </div>
  );
}

// Tailwind utilities aren't generated for dynamic class names, so list each
// accent color literally. We map to bg-{color}-500 instead of var(--{color})
// so widget tints are independent of the theme tokens (which only encode the
// neutral / destructive / etc. palette).
const ACCENT_BAR_CLASS = {
  yellow: "bg-yellow-500",
  blue: "bg-blue-500",
  purple: "bg-purple-500",
  green: "bg-green-500",
  orange: "bg-orange-500",
  red: "bg-red-500",
} as const;

type AccentColor = keyof typeof ACCENT_BAR_CLASS;

export function CatalogAccent({ props, children }: BaseProps<{ color: AccentColor }>) {
  return (
    <div className="flex items-stretch gap-3">
      <span
        aria-hidden
        className={cn(
          "w-1 shrink-0 rounded-full opacity-80 shadow-[0_0_18px_currentColor]",
          ACCENT_BAR_CLASS[props.color],
        )}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">{children}</div>
    </div>
  );
}

export function CatalogSeparator() {
  return <Separator />;
}

export function CatalogMarkdown({ props }: BaseProps<{ content?: string }>) {
  return (
    <div className="text-[13px] leading-[1.55] text-foreground">
      <Response>{props.content ?? ""}</Response>
    </div>
  );
}

export function CatalogBadge({
  props,
}: BaseProps<{
  text: string;
  variant?: "default" | "secondary" | "destructive" | "outline" | "ghost";
}>) {
  return <Badge variant={props.variant ?? "default"}>{props.text}</Badge>;
}

const avatarSizeMap = { sm: 24, default: 32, lg: 40 } as const;

export function CatalogAvatar({
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

export function CatalogSpinner({ props }: BaseProps<{ size?: "sm" | "default" | "lg" }>) {
  const size = avatarSizeMap[props.size ?? "default"] * 0.7;
  return <Spinner width={size} height={size} className="text-muted-foreground" />;
}

export function CatalogChart({
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

export function CatalogImage({
  props,
}: BaseProps<{ src: string; alt?: string; rounded?: boolean }>) {
  return (
    // Electron renderer — next/image does not apply here.
    // oxlint-disable-next-line next/no-img-element
    <img
      src={props.src}
      alt={props.alt ?? ""}
      className={cn("max-w-full object-cover", props.rounded === true && "rounded-[12px]")}
    />
  );
}

export function CatalogCollapsible({
  props,
  children,
}: BaseProps<{ title: string; defaultOpen?: boolean }>) {
  return (
    <Collapsible
      defaultOpen={props.defaultOpen === true}
      className="object-row rounded-[14px] border border-[var(--object-row-border)]"
    >
      <CollapsibleTrigger className="group flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium text-foreground">
        {props.title}
        <ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-data-[panel-open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-2 px-3 pb-3">{children}</CollapsibleContent>
    </Collapsible>
  );
}

export function CatalogTabs({ props, children }: BaseProps<{ tabs?: CatalogOption[] }>) {
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

export function CatalogTable({ props, children }: BaseProps<{ caption?: string }>) {
  return (
    <UiTable>
      {props.caption ? <TableCaption>{props.caption}</TableCaption> : null}
      {children}
    </UiTable>
  );
}

export function CatalogTableHeader({ children }: BaseProps<Record<string, never>>) {
  return <UiTableHeader>{children}</UiTableHeader>;
}

export function CatalogTableBody({ children }: BaseProps<Record<string, never>>) {
  return <UiTableBody>{children}</UiTableBody>;
}

export function CatalogTableRow({ children }: BaseProps<Record<string, never>>) {
  return <UiTableRow>{children}</UiTableRow>;
}

export function CatalogTableHead({ props }: BaseProps<{ text: string }>) {
  return <UiTableHead>{props.text}</UiTableHead>;
}

export function CatalogTableCell({ props, children }: BaseProps<{ text?: string }>) {
  return <UiTableCell>{props.text != null ? props.text : children}</UiTableCell>;
}
