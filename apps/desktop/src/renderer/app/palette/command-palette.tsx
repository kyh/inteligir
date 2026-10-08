import {
  CommandDialog,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandShortcut,
} from "@repo/ui/components/command";
import type { Thread } from "@repo/contract/local/threads/threads-schema";
import { platformShortcutModifier } from "@repo/ui/lib/hotkey-spelling";
import type { ShortcutModifier } from "@repo/ui/lib/hotkey-spelling";
import {
  KeyboardIcon,
  MessageSquarePlusIcon,
  MessagesSquareIcon,
  RefreshCwIcon,
  SettingsIcon,
} from "lucide-react";
import { useState } from "react";
import { bindingCapsFor } from "../global-shortcuts";
import type { GlobalShortcutAction } from "../global-shortcuts";
import { matchesQuery, PalettePage } from "./palette-page";
import { ShortcutsPage } from "./shortcuts-page";
import { ThreadsPage } from "./threads-page";

export interface PaletteActions {
  askAgent: () => void;
  openThread: (threadId: string) => void;
  syncNow: () => void;
  openSettings: () => void;
}

// the pages an entry point opens onto; ⌘P is the one that opens the root
export interface PaletteEntry {
  page: "root";
}

// One channel for every way the palette opens. The workspace bumps `nonce` per open and keys the
// palette on it, so each open mounts fresh and no state from the last open needs resetting.
export type PaletteRequest = PaletteEntry & { nonce: number };

type Page = PaletteEntry | { page: "threads" | "shortcuts" };

// what the one dialog says around a page
interface PageChrome {
  title: string;
  description: string;
  placeholder: string;
}

const PAGE_CHROME: Record<Page["page"], PageChrome> = {
  root: {
    description: "Run a command",
    placeholder: "Search commands…",
    title: "Command palette",
  },
  shortcuts: {
    description: "Every binding, spelled for this keyboard",
    placeholder: "Filter shortcuts…",
    title: "Keyboard shortcuts",
  },
  threads: {
    description: "Open a recent action in the panel",
    placeholder: "Find an action…",
    title: "Actions",
  },
};

export interface CommandPaletteProps {
  open: boolean;
  request: PaletteRequest;
  // how a binding is spelled; the workspace passes the one it listens with
  modifier?: ShortcutModifier;
  onOpenChange: (open: boolean) => void;
  threads: readonly Thread[];
  canSync: boolean;
  actions: PaletteActions;
}

interface StaticCommand {
  id: string;
  label: string;
  // the row's binding comes from the global table, so the palette never spells a chord itself
  binding?: GlobalShortcutAction;
  icon: React.ReactNode;
  keepOpen?: boolean;
  run: () => void;
}

// Every verb the root page can run, in the order it lists them.
const rootCommands = (
  actions: PaletteActions,
  canSync: boolean,
  goTo: (next: Page) => void,
): StaticCommand[] => [
  {
    binding: "open-action-composer",
    icon: <MessageSquarePlusIcon />,
    id: "ask-agent",
    label: "Ask the agent",
    run: () => {
      actions.askAgent();
    },
  },
  {
    icon: <MessagesSquareIcon />,
    id: "threads",
    keepOpen: true,
    label: "Actions",
    run: () => {
      goTo({ page: "threads" });
    },
  },
  ...(canSync
    ? [
        {
          icon: <RefreshCwIcon />,
          id: "sync-now",
          label: "Sync now",
          run: () => {
            actions.syncNow();
          },
        },
      ]
    : []),
  {
    icon: <KeyboardIcon />,
    id: "keyboard-shortcuts",
    keepOpen: true,
    label: "Keyboard shortcuts",
    run: () => {
      goTo({ page: "shortcuts" });
    },
  },
  {
    binding: "open-settings",
    icon: <SettingsIcon />,
    id: "settings",
    label: "Settings",
    run: () => {
      actions.openSettings();
    },
  },
];

export const CommandPalette = ({
  open,
  request,
  modifier = platformShortcutModifier(),
  onOpenChange,
  threads,
  canSync,
  actions,
}: CommandPaletteProps) => {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<Page>(request);

  const close = (): void => {
    onOpenChange(false);
  };
  const run = (action: () => void): void => {
    close();
    action();
  };
  const goTo = (next: Page): void => {
    setQuery("");
    setPage(next);
  };

  const body = (): React.ReactElement => {
    switch (page.page) {
      case "root": {
        const visibleCommands = rootCommands(actions, canSync, goTo).filter((command) =>
          matchesQuery(command.label, query),
        );
        return (
          <PalettePage>
            <CommandEmpty>Nothing matches.</CommandEmpty>
            {visibleCommands.length > 0 ? (
              <CommandGroup heading="Commands">
                {visibleCommands.map((command) => (
                  <CommandItem
                    key={command.id}
                    action={command.label}
                    onSelect={() => {
                      if (command.keepOpen === true) {
                        command.run();
                      } else {
                        run(command.run);
                      }
                    }}
                  >
                    {command.icon}
                    {command.label}
                    {command.binding === undefined ? null : (
                      <CommandShortcut caps={bindingCapsFor(command.binding, modifier)} />
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </PalettePage>
        );
      }
      case "shortcuts": {
        return <ShortcutsPage query={query} modifier={modifier} onPick={close} />;
      }
      case "threads": {
        return (
          <ThreadsPage
            open={open}
            query={query}
            threads={threads}
            onOpenThread={(threadId) => {
              run(() => {
                actions.openThread(threadId);
              });
            }}
          />
        );
      }
      default: {
        const exhaustive: never = page;
        return exhaustive;
      }
    }
  };

  // One dialog, one field and one hint strip for every page, so a page switch keeps the backdrop
  // still and the caret in the field; only the body under the field changes.
  const chrome = PAGE_CHROME[page.page];
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={chrome.title}
      description={chrome.description}
    >
      <CommandInput
        placeholder={chrome.placeholder}
        value={query}
        onValueChange={setQuery}
        aria-label={chrome.title}
      />
      {body()}
      <CommandFooter />
    </CommandDialog>
  );
};
