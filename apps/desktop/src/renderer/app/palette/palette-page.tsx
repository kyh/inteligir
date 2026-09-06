// The one shell every palette page draws: the dialog, its input, and the list the page fills.
// shouldFilter is off: each page filters its own rows, not cmdk's heuristics.

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@repo/ui/components/command";
import { cn } from "cn";
import { docStem } from "@repo/notes/knowledge/doc-file";
import { TEMPLATES_FOLDER } from "@repo/notes/templates/placeholders";
import { FolderIcon, LayoutTemplateIcon } from "lucide-react";
import { useEffect, useState } from "react";

export const SEARCH_DEBOUNCE_MS = 120;

// the typed text, settled: a query keyed on it fires once per pause, not per keystroke
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(value);
    }, ms);
    return () => {
      clearTimeout(timer);
    };
  }, [value, ms]);
  return settled;
}

export function matchesQuery(label: string, query: string): boolean {
  return label.toLowerCase().includes(query.trim().toLowerCase());
}

// what every page shares: the dialog's open state and the box's text
export interface PageShell {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (query: string) => void;
}

export interface PalettePageProps extends PageShell {
  title: string;
  description: string;
  placeholder: string;
  wide?: boolean;
  // between the input and the list: the search page's toggles and replace row
  toolbar?: React.ReactNode;
  children: React.ReactNode;
}

export function PalettePage({
  open,
  onOpenChange,
  title,
  description,
  placeholder,
  query,
  onQueryChange,
  wide = false,
  toolbar,
  children,
}: PalettePageProps) {
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      shouldFilter={false}
      className={cn(wide && "sm:max-w-2xl")}
    >
      <CommandInput placeholder={placeholder} value={query} onValueChange={onQueryChange} />
      {toolbar}
      <CommandList className={cn(wide && "max-h-96")}>{children}</CommandList>
    </CommandDialog>
  );
}

export interface FolderPageProps extends PageShell {
  title: string;
  description: string;
  placeholder: string;
  empty: string;
  // already narrowed to the rows the page may offer; "" is the vault root
  folders: readonly string[];
  onPick: (dir: string) => void;
}

// the one picker behind "New note in folder…" and "Move note to folder…"
export function FolderPage({
  title,
  description,
  placeholder,
  empty,
  folders,
  onPick,
  ...shell
}: FolderPageProps) {
  return (
    <PalettePage {...shell} title={title} description={description} placeholder={placeholder}>
      <CommandEmpty>{empty}</CommandEmpty>
      <CommandGroup heading="Folders">
        {folders.map((dir) => (
          <CommandItem key={dir === "" ? "(root)" : dir} onSelect={() => onPick(dir)}>
            <FolderIcon />
            {dir === "" ? "Vault root" : dir}
          </CommandItem>
        ))}
      </CommandGroup>
    </PalettePage>
  );
}

export function TemplateRows({
  templatePaths,
  query,
  onPick,
}: {
  templatePaths: readonly string[];
  query: string;
  onPick: (templatePath: string) => void;
}) {
  const visible = templatePaths.filter((path) => matchesQuery(docStem(path), query));
  return (
    <>
      <CommandEmpty>
        {templatePaths.length === 0
          ? `No templates yet — notes under ${TEMPLATES_FOLDER}/ appear here.`
          : "No matching template."}
      </CommandEmpty>
      <CommandGroup heading="Templates">
        {visible.map((path) => (
          <CommandItem key={path} onSelect={() => onPick(path)}>
            <LayoutTemplateIcon />
            <span className="truncate">{docStem(path)}</span>
            <span className="ml-auto truncate pl-3 text-xs text-muted-foreground">{path}</span>
          </CommandItem>
        ))}
      </CommandGroup>
    </>
  );
}
