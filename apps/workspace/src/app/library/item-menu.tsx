// A card's right-click menu, over the card it was opened on, or over the whole selection when that
// card is in it. Every verb is the caller's (`LibraryItemActions`); the menu only names them for
// the rows it was opened over, by what those rows are: a library item, or one in Deleted.

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@repo/ui/components/dropdown-menu";
import type { ReplicaListingRow } from "@repo/library-replica/library-replica";
import { plural } from "@repo/ui/lib/plural";

import { copyText } from "../copy-text";

export interface LibraryItemActions {
  readonly open: (row: ReplicaListingRow) => void;
  readonly quickLook: (row: ReplicaListingRow) => void;
  readonly pin: (rows: readonly ReplicaListingRow[], pinned: boolean) => void;
  readonly move: (rows: readonly ReplicaListingRow[]) => void;
  readonly tag: (rows: readonly ReplicaListingRow[]) => void;
  readonly askAgent: (rows: readonly ReplicaListingRow[]) => void;
  readonly refresh: (row: ReplicaListingRow) => void;
  readonly remove: (rows: readonly ReplicaListingRow[]) => void;
  readonly restore: (rows: readonly ReplicaListingRow[]) => void;
  readonly purge: (rows: readonly ReplicaListingRow[]) => void;
}

export interface ItemMenuState {
  readonly row: ReplicaListingRow;
  readonly anchor: HTMLElement;
  // what the verbs act on: the row alone, or the selection it is part of
  readonly subjects: readonly ReplicaListingRow[];
}

const DeletedVerbs = ({
  subjects,
  actions,
  run,
}: {
  subjects: readonly ReplicaListingRow[];
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
  const pinned = subjects.every((subject) => subject.pinnedAt !== null);
  const { url } = row;
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
          {menu.row.deletedAt === null ? (
            <LibraryVerbs menu={menu} actions={actions} run={run} />
          ) : (
            <DeletedVerbs subjects={menu.subjects} actions={actions} run={run} />
          )}
        </DropdownMenuContent>
      )}
    </DropdownMenu>
  );
};
