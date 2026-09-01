import {
  Command,
  CommandInput,
  CommandList,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandEmpty,
} from "@repo/ui";
import { FilePlus, Search, Moon, Bot, RotateCcw } from "lucide-react";

export function Palette() {
  return (
    <div className="border rounded-lg overflow-hidden" style={{ width: 400 }}>
      <Command>
        <CommandInput placeholder="Search notes and commands..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Actions">
            <CommandItem>
              <FilePlus />
              New note
              <CommandShortcut>⌘N</CommandShortcut>
            </CommandItem>
            <CommandItem>
              <Search />
              Search vault
              <CommandShortcut>⌘P</CommandShortcut>
            </CommandItem>
            <CommandItem>
              <Moon />
              Toggle theme
              <CommandShortcut>⌘⇧L</CommandShortcut>
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading="Agent">
            <CommandItem>
              <Bot />
              Ask agent
              <CommandShortcut>⌘K</CommandShortcut>
            </CommandItem>
            <CommandItem>
              <RotateCcw />
              Restore version
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </div>
  );
}

export function EmptyState() {
  return (
    <div className="border rounded-lg overflow-hidden" style={{ width: 400 }}>
      <Command shouldFilter={false}>
        <CommandInput placeholder="quarterly synthesis draft" />
        <CommandList>
          <CommandEmpty>No matching notes or commands.</CommandEmpty>
        </CommandList>
      </Command>
    </div>
  );
}
