// A card's right-click menu, over the card it was opened on, or over the whole selection when that
// card is in it. Every verb is the caller's (`LibraryItemActions`); the menu only names them for
// the rows it was opened over, by what those rows are: a library item, or one in Deleted.

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@repo/ui/components/dropdown-menu";
import { plural } from "@repo/ui/lib/plural";

import { copyText } from "../copy-text";
import type { ListedItem } from "./listing";

export interface LibraryItemActions {
  readonly open: (row: ListedItem) => void;
  readonly quickLook: (row: ListedItem) => void;
  readonly pin: (rows: readonly ListedItem[], pinned: boolean) => void;
  readonly move: (rows: readonly ListedItem[]) => void;
  readonly tag: (rows: readonly ListedItem[]) => void;
  readonly askAgent: (rows: readonly ListedItem[]) => void;
  readonly refresh: (row: ListedItem) => void;
  readonly remove: (rows: readonly ListedItem[]) => void;
  readonly restore: (rows: readonly ListedItem[]) => void;
  readonly purge: (rows: readonly ListedItem[]) => void;
}

// what the grid's owner answers: the grid draws its own Quick Look
export type LibraryGridActions = Omit<LibraryItemActions, "quickLook">;

export interface ItemMenuState {
  readonly row: ListedItem;
  readonly anchor: HTMLElement;
  // what the verbs act on: the row alone, or the selection it is part of
  readonly subjects: readonly ListedItem[];
}

const DeletedVerbs = ({
  subjects,
  actions,
  run,
}: {
  subjects: readonly ListedItem[];
  actions: LibraryItemActions;
  run: (verb: () => void) => () => void;
}) => {
  const many = subjects.length > 1;
  return (
    <>
      <DropdownMenuItem
        onClick={run(() => {
          actions.restore(subjects);
        })}
      >
        {many ? `Restore ${plural(subjects.length, "item")}` : "Restore"}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        variant="destructive"
        onClick={run(() => {
          actions.purge(subjects);
        })}
      >
        {many ? `Delete ${plural(subjects.length, "item")} forever…` : "Delete forever…"}
      </DropdownMenuItem>
    </>
  );
};

const LibraryVerbs = ({
  menu,
  actions,
  run,
}: {
  menu: ItemMenuState;
  actions: LibraryItemActions;
  run: (verb: () => void) => () => void;
}) => {
  const { row, subjects } = menu;
  const many = subjects.length > 1;
  const pinned = subjects.every((subject) => subject.fields.pinnedAt !== null);
  const { url } = row.fields;
  return (
    <>
      {many ? null : (
        <>
          <DropdownMenuItem
            onClick={run(() => {
              actions.open(row);
            })}
          >
            Open
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={run(() => {
              actions.quickLook(row);
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
      <DropdownMenuItem
        onClick={run(() => {
          actions.askAgent(subjects);
        })}
      >
        {many ? `Ask the agent about ${plural(subjects.length, "item")}` : "Ask the agent"}
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
      <DropdownMenuItem
        onClick={run(() => {
          actions.pin(subjects, !pinned);
        })}
      >
        {pinned ? "Unpin" : "Pin"}
      </DropdownMenuItem>
      {url === null || many ? null : (
        <DropdownMenuItem
          onClick={run(() => {
            actions.refresh(row);
          })}
        >
          Read the page again
        </DropdownMenuItem>
      )}
      <DropdownMenuSeparator />
      <DropdownMenuItem
        variant="destructive"
        onClick={run(() => {
          actions.remove(subjects);
        })}
      >
        {many ? `Delete ${plural(subjects.length, "item")}` : "Delete"}
      </DropdownMenuItem>
    </>
  );
};

export const ItemMenu = ({
  menu,
  actions,
  onClose,
}: {
  menu: ItemMenuState | null;
  actions: LibraryItemActions;
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
            <LibraryVerbs menu={menu} actions={actions} run={run} />
          ) : (
            <DeletedVerbs subjects={menu.subjects} actions={actions} run={run} />
          )}
        </DropdownMenuContent>
      )}
    </DropdownMenu>
  );
};
