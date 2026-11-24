import { shownTitle } from "@repo/contract/items/item-name";
import { isWebUrl } from "@repo/contract/items/item-url";
import { NEEDS_CONNECTION } from "@repo/contract/needs-connection";
import { refusalText } from "@repo/contract/rpc/refusal-text";
import {
  CommandDialog,
  CommandFooter,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
  CommandStatus,
} from "@repo/ui/components/command";
import type { CommandRow, CommandRowGroup } from "@repo/ui/components/command";
import { hotkeyCaps, platformShortcutModifier } from "@repo/ui/lib/hotkey-spelling";
import { useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { useState } from "react";
import { useStore } from "zustand";

import { TIDY_LABEL } from "../agent/tidy-library";
import { useLibraryQueries, usePageLibrary } from "../cloud/library-context";
import { cellStanding } from "../cloud/needs-connection";
import { useLibraryCommands } from "../library/library-commands";
import type { ListedItem } from "../cloud/library-queries";
import { hotkeyFor } from "../shortcuts";
import type { ShortcutIn } from "../shortcuts";

type WindowAction = ShortcutIn<"window">["action"];

interface PaletteRow extends CommandRow {
  readonly hit?: { readonly itemId: string; readonly snippet: string } | undefined;
  readonly chord?: WindowAction | undefined;
}

const Chord = ({ action }: { action: WindowAction }) => {
  const hotkey = hotkeyFor(action);

  return hotkey === null ? null : (
    <CommandShortcut caps={hotkeyCaps(hotkey, platformShortcutModifier())} />
  );
};

const TWO_LINE_ROW = "h-auto py-1";

const twoLines = (row: PaletteRow) => row.hit !== undefined && row.hit.snippet !== "";

const RowContent = ({ row }: { row: PaletteRow }) => {
  if (row.hit !== undefined) {
    return (
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{row.label}</span>
        {twoLines(row) ? (
          <span className="truncate text-caption text-muted-foreground">{row.hit.snippet}</span>
        ) : null}
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

const searchShown = (
  typed: string,
  search: UseQueryResult<{ readonly items: readonly ListedItem[] }>,
) => {
  if (typed === "") {
    return { hits: [], said: null };
  }

  const standing = cellStanding({
    data: search.isPlaceholderData ? undefined : search.data,
    error: search.error,
    fetchStatus: search.fetchStatus,
  });

  switch (standing.kind) {
    case "answered": {
      const hits = standing.data.items;

      return { hits, said: hits.length === 0 ? "Nothing in your library matches." : null };
    }

    case "loading": {
      return { hits: search.data?.items ?? [], said: null };
    }

    case "needs-connection": {
      return { hits: [], said: NEEDS_CONNECTION };
    }

    case "missing":
    case "unreachable": {
      return { hits: [], said: refusalText(standing.error, "Your library couldn't be searched.") };
    }

    default: {
      throw new Error(`unexpected ${String(standing satisfies never)}`);
    }
  }
};

export const CommandPalette = () => {
  const { workspace } = usePageLibrary();
  const commands = useLibraryCommands();
  const open = useStore(workspace.store, (state) => state.paletteOpen);
  const [query, setQuery] = useState("");
  const typed = query.trim();
  const { hits, said } = searchShown(typed, useQuery(useLibraryQueries().search(typed)));

  const close = () => {
    workspace.setPaletteOpen(false);
    setQuery("");
  };

  const run = (verb: () => void) => () => {
    close();
    verb();
  };

  const verb = (value: string, label: string, act: () => void, chord?: WindowAction) =>
    ({ chord, label, onSelect: run(act), value }) satisfies PaletteRow;

  const groups: CommandRowGroup<PaletteRow>[] = [
    ...(isWebUrl(typed)
      ? [
          {
            heading: "Save",
            items: [
              {
                action: "Save",
                label: "Save this link",
                onSelect: run(() => {
                  commands.saveLink(typed);
                }),
                value: "save-link",
              },
            ],
          },
        ]
      : []),
    ...(hits.length === 0
      ? []
      : [
          {
            heading: "Items",
            items: hits.map(
              (hit) =>
                ({
                  action: "Open",
                  hit: { itemId: hit.id, snippet: hit.snippet ?? "" },
                  label: shownTitle(hit.card.title),
                  onSelect: run(() => {
                    commands.openItem(hit.id, typed);
                  }),
                  value: `hit:${hit.id}`,
                }) satisfies PaletteRow,
            ),
          },
        ]),
    {
      heading: "Commands",
      items: [
        verb("new-note", "New note", commands.newNote),
        verb("ask-save-link", "Save a link…", commands.askSaveLink),
        verb("ask-agent", "Ask the agent", commands.askAgent, "open-agent"),
        verb("tidy", TIDY_LABEL, commands.startTidy),
        verb("settings", "Settings", commands.openSettings, "open-settings"),
      ],
    },
  ];

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          workspace.setPaletteOpen(true);
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
      <CommandStatus>{said}</CommandStatus>
      <CommandList>
        {groups.map((group) => (
          <CommandGroup key={group.heading} heading={group.heading}>
            {group.items.map((row) => (
              <CommandItem
                key={row.value}
                row={row}
                className={twoLines(row) ? TWO_LINE_ROW : ""}
                data-search-hit={row.hit?.itemId}
              >
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
