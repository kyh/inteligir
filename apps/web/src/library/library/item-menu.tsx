// A card's right-click menu, over the card it was opened on, or over the whole selection when that
// card is in it. Every verb is a command (`./library-commands.tsx`); the menu only names them for
// the rows it was opened over, by what those rows are: a library item, or one in Deleted.

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@repo/ui/components/dropdown-menu";
import { plural } from "@repo/ui/lib/plural";

import { copyText } from "../copy-text";
import { useLibraryCommands } from "./library-commands";
import type { ListedItem } from "./listing";

export interface ItemMenuState {
  readonly row: ListedItem;
  readonly anchor: HTMLElement;
  // what the verbs act on: the row alone, or the selection it is part of. The grid selects a card
  // it opens the menu on, so the subjects are the selection a message to the agent carries
  readonly subjects: readonly ListedItem[];
}

const idsOf = (rows: readonly ListedItem[]): string[] => rows.map((row) => row.id);

const DeletedVerbs = ({
  subjects,
  run,
}: {
  subjects: readonly ListedItem[];
  run: (verb: () => void) => () => void;
}) => {
  const commands = useLibraryCommands();
  const many = subjects.length > 1;
  return (
    <>
      <DropdownMenuItem
        onClick={run(() => {
          commands.restore(idsOf(subjects));
        })}
      >
        {many ? `Restore ${plural(subjects.length, "item")}` : "Restore"}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        variant="destructive"
        onClick={run(() => {
          commands.purge(idsOf(subjects));
        })}
      >
        {many ? `Delete ${plural(subjects.length, "item")} forever…` : "Delete forever…"}
      </DropdownMenuItem>
    </>
  );
};

const LibraryVerbs = ({
  menu,
  onQuickLook,
  run,
}: {
  menu: ItemMenuState;
  onQuickLook: (row: ListedItem) => void;
  run: (verb: () => void) => () => void;
}) => {
  const commands = useLibraryCommands();
  const { row, subjects } = menu;
  const ids = idsOf(subjects);
  const many = subjects.length > 1;
  const pinned = subjects.every((subject) => subject.fields.pinnedAt !== null);
  const { url } = row.fields;
  return (
    <>
      {many ? null : (
        <>
          <DropdownMenuItem
            onClick={run(() => {
              commands.openItem(row.id);
            })}
          >
            Open
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={run(() => {
              onQuickLook(row);
            })}
          >
            Quick Look
          </DropdownMenuItem>
          <DropdownMenuSeparator />
        </>
      )}
      {url === null || many ? null : (
        <DropdownMenuItem
          onClick={run(() => {
            void copyText(url, "Address copied");
          })}
        >
          Copy address
        </DropdownMenuItem>
      )}
      <DropdownMenuItem onClick={run(commands.askAgent)}>
        {many ? `Ask the agent about ${plural(subjects.length, "item")}` : "Ask the agent"}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onClick={run(() => {
          commands.tag(subjects.map(({ fields, id }) => ({ id, tags: fields.tags })));
        })}
      >
        {many ? `Tag ${plural(subjects.length, "item")}…` : "Tag…"}
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={run(() => {
          commands.move(ids);
        })}
      >
        {many ? `Move ${plural(subjects.length, "item")} to…` : "Move to…"}
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={run(() => {
          commands.pin(ids, !pinned);
        })}
      >
        {pinned ? "Unpin" : "Pin"}
      </DropdownMenuItem>
      {url === null || many ? null : (
        <DropdownMenuItem
          onClick={run(() => {
            commands.refresh(row.id);
          })}
        >
          Read the page again
        </DropdownMenuItem>
      )}
      <DropdownMenuSeparator />
      <DropdownMenuItem
        variant="destructive"
        onClick={run(() => {
          commands.remove(ids);
        })}
      >
        {many ? `Delete ${plural(subjects.length, "item")}` : "Delete"}
      </DropdownMenuItem>
    </>
  );
};

export const ItemMenu = ({
  menu,
  onQuickLook,
  onClose,
}: {
  menu: ItemMenuState | null;
  onQuickLook: (row: ListedItem) => void;
  onClose: () => void;
}) => {
  const run = (verb: () => void) => () => {
    onClose();
    verb();
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
      {menu === null ? null : (
        <DropdownMenuContent anchor={menu.anchor} side="bottom" align="start">
          {menu.row.fields.deletedAt === null ? (
            <LibraryVerbs menu={menu} onQuickLook={onQuickLook} run={run} />
          ) : (
            <DeletedVerbs subjects={menu.subjects} run={run} />
          )}
        </DropdownMenuContent>
      )}
    </DropdownMenu>
  );
};
