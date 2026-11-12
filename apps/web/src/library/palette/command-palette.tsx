// CLAUDE.md § There is one search surface, and it is ⌘P. One field over the library and the page's
// commands: what is typed is searched by the cell's full-text index (titles, notes and saved
// articles), ranked as the cell ranks it for every device; a hit opens its item with the find
// bar on the words, and a typed web address offers to save it. The commands are the page's verbs
// that need no item: a new note, a link, the agent and Tidy my library, Settings.

import { shownTitle } from "@repo/contract/items/item-name";
import { isWebUrl } from "@repo/contract/items/item-url";
import {
  CommandDialog,
  CommandFooter,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@repo/ui/components/command";
import type { CommandRow, CommandRowGroup } from "@repo/ui/components/command";
import { hotkeyCaps, platformShortcutModifier } from "@repo/ui/lib/hotkey-spelling";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { TIDY_LABEL } from "../agent/tidy-library";
import { useLibraryQueries } from "../cloud/library-context";
import { hotkeyFor } from "../shortcuts";
import type { ShortcutIn } from "../shortcuts";

type WindowAction = ShortcutIn<"window">["action"];

export interface PaletteActions {
  // a search's hit, opened on the words it was found by
  readonly openHit: (itemId: string, query: string) => void;
  readonly newNote: () => void;
  readonly saveLink: (url: string) => void;
  readonly askSaveLink: () => void;
  readonly openSettings: () => void;
  readonly askAgent: () => void;
  readonly startTidy: () => void;
}

// a row of the palette: a search's hit, which draws its snippet under its title, or a verb, which
// draws the chord the window answers it by
interface PaletteRow extends CommandRow {
  readonly hit?: { readonly itemId: string; readonly snippet: string } | undefined;
  readonly chord?: WindowAction | undefined;
}

// the chord a command answers to, as the window's table spells it
const Chord = ({ action }: { action: WindowAction }) => {
  const hotkey = hotkeyFor(action);
  return hotkey === null ? null : (
    <CommandShortcut caps={hotkeyCaps(hotkey, platformShortcutModifier())} />
  );
};

const RowContent = ({ row }: { row: PaletteRow }) => {
  if (row.hit !== undefined) {
    return (
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{row.label}</span>
        {row.hit.snippet === "" ? null : (
          <span className="truncate text-caption text-muted-foreground">{row.hit.snippet}</span>
        )}
      </span>
    );
  }
  return (
    <>
      {row.label}
      {row.chord === undefined ? null : <Chord action={row.chord} />}
    </>
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
  const hits = useQuery(useLibraryQueries().search(typed)).data?.items ?? [];
  const close = (): void => {
    onOpenChange(false);
    setQuery("");
  };
  const run = (verb: () => void) => () => {
    close();
    verb();
  };
  const verb = (
    value: string,
    label: string,
    act: () => void,
    chord?: WindowAction,
  ): PaletteRow => ({ chord, label, onSelect: run(act), value });
  const groups: CommandRowGroup<PaletteRow>[] = [
    ...(typed === "" || hits.length === 0
      ? []
      : [
          {
            heading: "Items",
            items: hits.map((hit): PaletteRow => ({
              action: "Open",
              hit: { itemId: hit.id, snippet: hit.snippet ?? "" },
              label: shownTitle(hit.card.title),
              onSelect: run(() => {
                actions.openHit(hit.id, typed);
              }),
              value: `hit:${hit.id}`,
            })),
          },
        ]),
    ...(isWebUrl(typed)
      ? [
          {
            heading: "Save",
            items: [
              {
                action: "Save",
                label: "Save this link",
                onSelect: run(() => {
                  actions.saveLink(typed);
                }),
                value: "save-link",
              },
            ],
          },
        ]
      : []),
    {
      heading: "Commands",
      items: [
        verb("new-note", "New note", actions.newNote),
        verb("ask-save-link", "Save a link…", actions.askSaveLink),
        verb("ask-agent", "Ask the agent", actions.askAgent, "open-agent"),
        verb("tidy", TIDY_LABEL, actions.startTidy),
        verb("settings", "Settings", actions.openSettings, "open-settings"),
      ],
    },
  ];
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
      query={query}
      onQueryChange={setQuery}
      groups={groups}
    >
      <CommandInput aria-label="Search the library" placeholder="Search the library…" />
      <CommandList>
        {groups.map((group) => (
          <CommandGroup key={group.heading} heading={group.heading}>
            {group.items.map((row) => (
              <CommandItem key={row.value} row={row} data-search-hit={row.hit?.itemId}>
                <RowContent row={row} />
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
      <CommandFooter />
    </CommandDialog>
  );
};
