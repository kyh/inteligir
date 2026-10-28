// The verbs a card offers on a right-click, in the order they read. A verb that can take many
// (Tag, Move, Delete, Ask agent) takes the whole selection when the card is one of several
// selected; every other verb is the card's own. The same verbs map to the same calls wherever
// they appear (here, Info and the palette): `itemCalls`.

import type { ItemRowWire } from "@repo/contract/local/items/items-schema";
import { getEditorHostIo } from "@repo/editor/host-io";
import { wikiLinkFor } from "@repo/notes/knowledge/link-resolve";
import { openExternalUrl } from "@repo/editor/lib/open-external-url";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@repo/ui/components/dropdown-menu";
import { toast } from "@repo/ui/components/sonner";
import { plural } from "@repo/ui/lib/plural";

import { copyText } from "../copy-text";
import { isUrlItem } from "./item-labels";

export interface LibraryItemActions {
  open: (path: string) => void;
  quickLook: (path: string) => void;
  askAgent: (paths: readonly string[]) => void;
  tag: (paths: readonly string[]) => void;
  move: (paths: readonly string[]) => void;
  rename: (path: string) => void;
  setPinned: (path: string, pinned: boolean) => void;
  keepCopy: (path: string) => void;
  // `replace`: the saved text is replaced with the page as it is now, asked first
  refresh: (path: string, replace: boolean) => void;
  // absent outside the shell, which is the one way to the OS
  reveal: ((path: string) => void) | null;
  remove: (paths: readonly string[]) => void;
}

export interface ItemMenuState {
  row: ItemRowWire;
  anchor: HTMLElement;
  // what a many-item verb takes: the selection when the card is one of several, else the card
  subjects: readonly string[];
}

// the item's [[wiki link]], for every kind: pasted into a note it links the item
export const copyItemLink = (path: string): void => {
  const link = wikiLinkFor(path, getEditorHostIo().linkResolver.getState().resolveWikiTarget);
  if (link === null) {
    toast.error("No link can name this item, so nothing was copied.");
    return;
  }
  void copyText(link, "Link copied");
};

export const ItemMenu = ({
  menu,
  onClose,
  actions,
}: {
  menu: ItemMenuState | null;
  onClose: () => void;
  actions: LibraryItemActions;
}) => {
  const run = (action: () => void) => () => {
    onClose();
    action();
  };
  const content = () => {
    if (menu === null) {
      return null;
    }
    const { row, subjects } = menu;
    const many = subjects.length > 1;
    const url = isUrlItem(row) ? row.url : null;
    return (
      <DropdownMenuContent anchor={menu.anchor} align="start" side="bottom">
        <DropdownMenuItem
          onClick={run(() => {
            actions.open(row.path);
          })}
        >
          Open
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={run(() => {
            actions.quickLook(row.path);
          })}
        >
          Quick Look
        </DropdownMenuItem>
        {url === null ? null : (
          <DropdownMenuItem
            onClick={run(() => {
              openExternalUrl(url);
            })}
          >
            Open original
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        {url === null ? null : (
          <DropdownMenuItem
            onClick={run(() => {
              void copyText(url, "Address copied");
            })}
          >
            Copy address
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onClick={run(() => {
            copyItemLink(row.path);
          })}
        >
          Copy link
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={run(() => {
            actions.askAgent(subjects);
          })}
        >
          {many ? `Ask agent about ${plural(subjects.length, "item")}` : "Ask agent"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={run(() => {
            actions.tag(subjects);
          })}
        >
          {many ? `Tag ${plural(subjects.length, "item")}…` : "Tag…"}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={run(() => {
            actions.move(subjects);
          })}
        >
          {many ? `Move ${plural(subjects.length, "item")} to…` : "Move to…"}
        </DropdownMenuItem>
        {many ? null : (
          <DropdownMenuItem
            onClick={run(() => {
              actions.rename(row.path);
            })}
          >
            Rename…
          </DropdownMenuItem>
        )}
        {row.bare ? null : (
          <DropdownMenuItem
            onClick={run(() => {
              actions.setPinned(row.path, !row.pinned);
            })}
          >
            {row.pinned ? "Unpin" : "Pin"}
          </DropdownMenuItem>
        )}
        {url === null ? null : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={run(() => {
                actions.keepCopy(row.path);
              })}
            >
              Keep a copy of the page
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(event) => {
                const replace = event.altKey;
                onClose();
                actions.refresh(row.path, replace);
              }}
            >
              Refresh from the page
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        {actions.reveal === null ? null : (
          <DropdownMenuItem
            onClick={run(() => {
              actions.reveal?.(row.file ?? row.path);
            })}
          >
            Reveal in Finder
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          variant="destructive"
          onClick={run(() => {
            actions.remove(subjects);
          })}
        >
          {many ? `Delete ${plural(subjects.length, "item")}` : "Delete"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    );
  };
  return (
    <DropdownMenu
      open={menu !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      {content()}
    </DropdownMenu>
  );
};
