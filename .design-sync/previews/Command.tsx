import {
  Command,
  CommandInput,
  CommandList,
  CommandGroup,
  CommandItem,
  CommandSeparator,
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
              <CommandShortcut>⌘K</CommandShortcut>
            </CommandItem>
            <CommandItem>
              <Moon />
              Toggle theme
              <CommandShortcut>⌘⇧L</CommandShortcut>
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Tasks">
            <CommandItem>
              <Bot />
              Delegate task to agent
              <CommandShortcut>⌘D</CommandShortcut>
            </CommandItem>
            <CommandItem>
              <RotateCcw />
              Restore original
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
