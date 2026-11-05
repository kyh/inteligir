// CLAUDE.md § THERE IS ONE SEARCH SURFACE, AND IT IS ⌘P. One field over the library and the page's
// commands: what is typed is searched in the replica's own full-text index (titles, notes, saved
// articles and highlights), ranked as every device ranks it, and a typed web address offers to
// save it. The commands are the page's verbs that need no item: a new note, a link, Settings.

import { isWebUrl } from "@repo/notes/items/item-url";
import {
  CommandDialog,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@repo/ui/components/command";
import { hotkeyCaps, platformShortcutModifier } from "@repo/ui/lib/hotkey-spelling";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { useReplicaQueries } from "../cloud/library-context";
import { GLOBAL_SHORTCUTS, globalShortcutHotkey } from "../global-shortcuts";
import type { GlobalShortcutAction } from "../global-shortcuts";

const SEARCH_LIMIT = 20;

// the chord a command answers to, as the window's table spells it
const Chord = ({ action }: { action: GlobalShortcutAction }) => {
  const row = GLOBAL_SHORTCUTS.find((shortcut) => shortcut.action === action);
  return row === undefined ? null : (
    <CommandShortcut caps={hotkeyCaps(globalShortcutHotkey(row), platformShortcutModifier())} />
  );
};

export interface PaletteActions {
  readonly openItem: (itemId: string) => void;
  readonly newNote: () => void;
  readonly saveLink: (url: string) => void;
  readonly askSaveLink: () => void;
  readonly openSettings: () => void;
  readonly askAgent: () => void;
}

const Results = ({ query, onOpen }: { query: string; onOpen: (itemId: string) => void }) => {
  const hits = useQuery(useReplicaQueries().search(query, SEARCH_LIMIT)).data ?? [];
  return (
    <CommandGroup heading="Items">
      {hits.map((hit) => (
        <CommandItem
          key={hit.itemId}
          action="Open"
          data-search-hit={hit.itemId}
          onSelect={() => {
            onOpen(hit.itemId);
          }}
        >
          <span className="flex min-w-0 flex-col">
            <span className="truncate">{hit.title}</span>
            {hit.snippet === "" ? null : (
              <span className="truncate text-caption text-muted-foreground">{hit.snippet}</span>
            )}
          </span>
        </CommandItem>
      ))}
    </CommandGroup>
  );
};

export const CommandPalette = ({
  open,
  onOpenChange,
  actions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: PaletteActions;
}) => {
  const [query, setQuery] = useState("");
  const typed = query.trim();
  const close = (): void => {
    onOpenChange(false);
    setQuery("");
  };
  const run = (verb: () => void) => () => {
    close();
    verb();
  };
  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          onOpenChange(true);
        } else {
          close();
        }
      }}
      title="Search"
      description="Search the library, or run a command"
    >
      <CommandInput
        aria-label="Search the library"
        placeholder="Search the library…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {typed === "" ? null : (
          <Results
            query={typed}
            onOpen={(itemId) => {
              close();
              actions.openItem(itemId);
            }}
          />
        )}
        {isWebUrl(typed) ? (
          <CommandGroup heading="Save">
            <CommandItem
              action="Save"
              onSelect={run(() => {
                actions.saveLink(typed);
              })}
            >
              Save this link
            </CommandItem>
          </CommandGroup>
        ) : null}
        <CommandGroup heading="Commands">
          <CommandItem onSelect={run(actions.newNote)}>New note</CommandItem>
          <CommandItem onSelect={run(actions.askSaveLink)}>Save a link…</CommandItem>
          <CommandItem onSelect={run(actions.askAgent)}>
            Ask the agent
            <Chord action="open-agent" />
          </CommandItem>
          <CommandItem onSelect={run(actions.openSettings)}>
            Settings
            <Chord action="open-settings" />
          </CommandItem>
        </CommandGroup>
        <CommandEmpty>Nothing matches.</CommandEmpty>
      </CommandList>
      <CommandFooter />
    </CommandDialog>
  );
};
