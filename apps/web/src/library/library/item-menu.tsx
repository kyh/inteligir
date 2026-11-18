import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@repo/ui/components/dropdown-menu";
import { plural } from "@repo/ui/lib/plural";

import { copyText } from "../copy-text";
import { useLibraryCommands } from "./library-commands";
import { targetCount } from "./library-selection";
import type { Target } from "./library-selection";
import type { ListedItem } from "./listing";

export type MenuOpener = "pointer" | "key";

export interface ItemMenuState {
  readonly row: ListedItem;
  readonly anchor: HTMLElement;
  readonly openedBy: MenuOpener;
  readonly target: Target;
  readonly subjects: readonly ListedItem[];
}

const DeletedVerbs = ({
  target,
  run,
}: {
  target: Target;
  run: (verb: () => void) => () => void;
}) => {
  const commands = useLibraryCommands();
  const count = targetCount(target);
  const many = count > 1;

  return (
    <>
      <DropdownMenuItem
        onClick={run(() => {
          commands.restore(target);
        })}
      >
        {many ? `Restore ${plural(count, "item")}` : "Restore"}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        variant="destructive"
        onClick={run(() => {
          commands.purge(target);
        })}
      >
        {many ? `Delete ${plural(count, "item")} forever…` : "Delete forever…"}
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
  const { row, subjects, target } = menu;
  const count = targetCount(target);
  const many = count > 1;

  const pinned =
    target.kind === "ids" && subjects.every((subject) => subject.fields.pinnedAt !== null);

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
        {many ? `Ask the agent about ${plural(count, "item")}` : "Ask the agent"}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onClick={run(() => {
          commands.tag(
            target,
            subjects.map((subject) => subject.fields.tags),
          );
        })}
      >
        {many ? `Tag ${plural(count, "item")}…` : "Tag…"}
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={run(() => {
          commands.move(target);
        })}
      >
        {many ? `Move ${plural(count, "item")} to…` : "Move to…"}
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={run(() => {
          commands.pin(target, !pinned);
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
          commands.remove(target);
        })}
      >
        {many ? `Delete ${plural(count, "item")}` : "Delete"}
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
        <DropdownMenuContent
          anchor={menu.anchor}
          side="bottom"
          align="start"
          openedByKey={menu.openedBy === "key"}
        >
          {menu.row.fields.deletedAt === null ? (
            <LibraryVerbs menu={menu} onQuickLook={onQuickLook} run={run} />
          ) : (
            <DeletedVerbs target={menu.target} run={run} />
          )}
        </DropdownMenuContent>
      )}
    </DropdownMenu>
  );
};
