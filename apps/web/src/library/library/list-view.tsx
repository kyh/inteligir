import { shownTitle } from "@repo/contract/items/item-name";
import type { ItemKind } from "@repo/contract/items/item-kind";
import type { PropertyOp } from "@repo/contract/library/field-ops";
import type { ListSettings, PropertyValue } from "@repo/contract/library/library-item";
import { groupsOf } from "@repo/contract/library/list-settings";
import { refusalText } from "@repo/contract/rpc/refusal-text";
import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ui/components/dropdown-menu";
import { toast } from "@repo/ui/components/sonner";
import { cn } from "@repo/ui/lib/cn";
import { platformShortcutModifier } from "@repo/ui/lib/hotkey-spelling";
import { formatCount } from "@repo/ui/lib/plural";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ChevronRight as ChevronRightIcon,
  DotsHorizontal as EllipsisIcon,
  File01 as FileIcon,
  File04 as FileTextIcon,
  Folder as FolderIcon,
  Image01 as ImageIcon,
  Link01 as LinkIcon,
  List as ListIcon,
  MusicNote01 as MusicIcon,
  Play as PlayIcon,
  Plus as PlusIcon,
} from "@untitledui/icons";
import type { IconComponent } from "@repo/ui/lib/icon";
import { useEffect, useEffectEvent, useState } from "react";
import { z } from "zod";

import { useLibraryQueries, useLibraryWrites } from "../cloud/library-context";
import { shortcutFor } from "../shortcuts";
import { TopBar } from "../top-bar";
import { ListProperties } from "./list-properties";
import { useLibraryCommands } from "./library-commands";
import { useLibraryVerbs } from "./library-verbs";
import type { ListedItem } from "../cloud/library-queries";

const KIND_ICONS = {
  audio: MusicIcon,
  file: FileIcon,
  folder: FolderIcon,
  image: ImageIcon,
  link: LinkIcon,
  list: ListIcon,
  note: FileTextIcon,
  pdf: FileTextIcon,
  video: PlayIcon,
} satisfies Record<ItemKind, IconComponent>;

const NO_PROPERTIES: ListSettings = { groupBy: null, properties: [] };

const DRAG_TYPE = "application/x-inteligir-item";

const words = z.string();

const valueText = (value: PropertyValue | undefined) => {
  if (value === undefined) {
    return null;
  }

  const read = words.safeParse(value);

  return read.success ? read.data : JSON.stringify(value);
};

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

const listRowsInOrder = (list: ListSettings, rows: readonly ListedItem[]) =>
  groupsOf(
    list,
    rows.map((row) => ({ properties: row.fields.properties, row })),
  ).map(({ items, option }) => ({ option, rows: items.map(({ row }) => row) }));

const groupLabel = (list: ListSettings, option: string | null) =>
  option ?? (list.groupBy === null ? "Everything" : `No ${list.groupBy}`);

interface Placing {
  readonly list: ListSettings;
  readonly find: (id: string) => ListedItem | undefined;
  readonly place: (row: ListedItem, option: string | null) => void;
}

const RowChips = ({ list, row }: { readonly list: ListSettings; readonly row: ListedItem }) => (
  <span className="flex min-w-0 shrink items-center gap-1 overflow-hidden">
    {list.properties.flatMap((property) => {
      if (property.name === list.groupBy) {
        return [];
      }

      const text = valueText(row.fields.properties[property.name]);

      if (text === null || text === "") {
        return [];
      }

      return [<Badge key={property.name}>{property.type === "url" ? hostOf(text) : text}</Badge>];
    })}
  </span>
);

const ListRow = ({
  row,
  open,
  placing,
}: {
  readonly row: ListedItem;
  readonly open: boolean;
  readonly placing: Placing;
}) => {
  const commands = useLibraryCommands();
  const Icon = KIND_ICONS[row.fields.kind];
  const title = shownTitle(row.card.title);
  const { groupBy } = placing.list;

  const options =
    placing.list.properties.find(
      (property) => property.name === groupBy && property.type === "select",
    ) ?? null;

  return (
    <li
      className={cn(
        "group/list-row relative flex h-8 items-center gap-1 rounded-xl pr-1 transition-colors duration-80 hover:bg-accent",
        open ? "bg-accent" : "",
      )}
      data-list-row={row.id}
    >
      <button
        type="button"
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData(DRAG_TYPE, row.id);
          event.dataTransfer.effectAllowed = "move";
        }}
        aria-current={open ? "page" : undefined}
        className="flex h-full min-w-0 flex-1 items-center gap-2 px-2 text-left outline-none"
        onClick={() => {
          commands.openItem(row.id);
        }}
      >
        <Icon size={14} strokeWidth={1.5} className="shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate text-body">{title}</span>
        <RowChips list={placing.list} row={row} />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              size="icon"
              variant="ghost"
              className="size-6 shrink-0 opacity-0 group-hover/list-row:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100"
              aria-label={`More for ${title}`}
            />
          }
        >
          <EllipsisIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {options?.type === "select" ? (
            <>
              <DropdownMenuRadioGroup
                value={valueText(row.fields.properties[options.name]) ?? ""}
                onValueChange={(value) => {
                  const picked = words.safeParse(value);

                  if (picked.success) {
                    placing.place(row, picked.data === "" ? null : picked.data);
                  }
                }}
              >
                {options.options.map(({ name }) => (
                  <DropdownMenuRadioItem key={name} value={name}>
                    {name}
                  </DropdownMenuRadioItem>
                ))}
                <DropdownMenuRadioItem value="">No {options.name}</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
            </>
          ) : null}
          <DropdownMenuItem
            onClick={() => {
              commands.openItem(row.id);
            }}
          >
            Open
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={() => {
              commands.remove({ ids: [row.id], kind: "ids" });
            }}
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
};

const ListGroup = ({
  option,
  rows,
  openItem,
  placing,
  grouped,
  onNew,
}: {
  readonly option: string | null;
  readonly rows: readonly ListedItem[];
  readonly openItem: string | null;
  readonly placing: Placing;
  readonly grouped: boolean;
  readonly onNew: (option: string | null) => void;
}) => {
  const [closed, setClosed] = useState(false);
  const [over, setOver] = useState(false);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const label = groupLabel(placing.list, option);
  const held = new Set(rows.map((row) => row.id));

  const dropped = useEffectEvent((id: string) => {
    const row = placing.find(id);

    if (row !== undefined && !held.has(id)) {
      placing.place(row, option);
    }
  });

  useEffect(() => {
    if (target === null || !grouped) {
      return;
    }

    const carries = (event: DragEvent) => event.dataTransfer?.types.includes(DRAG_TYPE) === true;

    const onOver = (event: DragEvent) => {
      if (carries(event)) {
        event.preventDefault();
        setOver(true);
      }
    };

    const onLeave = () => {
      setOver(false);
    };

    const onDrop = (event: DragEvent) => {
      setOver(false);

      if (carries(event)) {
        event.preventDefault();
        dropped(event.dataTransfer?.getData(DRAG_TYPE) ?? "");
      }
    };

    target.addEventListener("dragover", onOver);
    target.addEventListener("dragleave", onLeave);
    target.addEventListener("drop", onDrop);

    return () => {
      target.removeEventListener("dragover", onOver);
      target.removeEventListener("dragleave", onLeave);
      target.removeEventListener("drop", onDrop);
    };
  }, [target, grouped]);

  return (
    <section
      ref={setTarget}
      aria-label={label}
      data-list-group={option ?? ""}
      className={cn(
        "flex flex-col gap-0.5 rounded-2xl p-1 transition-colors duration-80",
        over ? "bg-accent/60" : "",
      )}
    >
      {grouped ? (
        <div className="flex h-7 items-center gap-1 px-1">
          <button
            type="button"
            aria-expanded={!closed}
            className="flex min-w-0 items-center gap-1.5 rounded-lg px-1 text-caption font-medium text-muted-foreground outline-none hover:text-foreground"
            onClick={() => {
              setClosed(!closed);
            }}
          >
            <ChevronRightIcon
              size={12}
              strokeWidth={1.5}
              className={cn("transition-transform duration-80", closed ? "" : "rotate-90")}
            />
            <span className="truncate">{label}</span>
            <span className="tabular-nums">{formatCount(rows.length)}</span>
          </button>
          <span className="h-px flex-1 bg-border" />
          <Button
            size="icon"
            variant="ghost"
            className="size-6"
            aria-label={`New note in ${label}`}
            onClick={() => {
              onNew(option);
            }}
          >
            <PlusIcon />
          </Button>
        </div>
      ) : null}
      {closed ? null : (
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {rows.map((row) => (
            <ListRow key={row.id} row={row} open={openItem === row.id} placing={placing} />
          ))}
        </ul>
      )}
    </section>
  );
};

export interface ListViewProps {
  readonly listId: string;
  readonly rows: readonly ListedItem[];
  readonly total: number | null;
  readonly openItem: string | null;
}

export const ListView = ({ listId, rows, total, openItem }: ListViewProps) => {
  const commands = useLibraryCommands();
  const verbs = useLibraryVerbs();
  const queries = useLibraryQueries();
  const writes = useLibraryWrites();
  const writeFields = useMutation(writes.writeFields());
  const listItem = useQuery(queries.item(listId)).data;
  const list = listItem?.fields.list ?? NO_PROPERTIES;
  const title = listItem === undefined ? "" : shownTitle(listItem.card.title);
  const groups = listRowsInOrder(list, rows);
  const ordered = groups.flatMap((group) => group.rows);
  const grouped = list.groupBy !== null;
  const byId = new Map(rows.map((row) => [row.id, row]));
  const modifier = platformShortcutModifier();

  const setValue = async (
    itemId: string,
    held: PropertyValue | undefined,
    option: string | null,
  ) => {
    if (list.groupBy === null) {
      return;
    }

    const op: PropertyOp = { key: list.groupBy, op: "property" };

    if (held !== undefined) {
      op.base = held;
    }

    if (option !== null) {
      op.value = option;
    }

    await writeFields.mutateAsync({ itemId, opId: crypto.randomUUID(), ops: [op] });
  };

  const placing: Placing = {
    find: (id: string) => byId.get(id),
    list,
    place: (row: ListedItem, option: string | null) => {
      const held = list.groupBy === null ? undefined : row.fields.properties[list.groupBy];

      if ((valueText(held) ?? null) === option) {
        return;
      }

      void setValue(row.id, held, option).catch(() => null);
    },
  };

  const newNote = async (option: string | null) => {
    try {
      const id = await verbs.createNote({ parentId: listId, tags: [] });

      if (option !== null) {
        await setValue(id, undefined, option);
      }

      commands.openItem(id);
    } catch (error) {
      toast.error(refusalText(error, "The note couldn't be made."));
    }
  };

  const firstOption = grouped
    ? (groups.find(({ option }) => option !== null)?.option ?? null)
    : null;

  const step = useEffectEvent((by: number) => {
    const at = ordered.findIndex((row) => row.id === openItem);
    const next = ordered[at + by];

    if (at !== -1 && next !== undefined) {
      commands.openItem(next.id);
    }
  });

  useEffect(() => {
    if (openItem === null) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const shortcut = shortcutFor(event, "list", modifier);

      if (shortcut === null) {
        return;
      }

      event.preventDefault();
      step(shortcut.action === "next-in-list" ? 1 : -1);
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [openItem, modifier]);

  return (
    <div className="flex h-full min-h-0 flex-col" data-list-view={listId}>
      <TopBar className="px-4">
        <h1 className="m-0 truncate text-title font-medium">{title}</h1>
        {total === null ? null : (
          <span className="text-body text-muted-foreground tabular-nums">{formatCount(total)}</span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {listItem === undefined ? null : <ListProperties listId={listId} list={list} />}
          <Button
            variant="secondary"
            onClick={() => {
              void newNote(firstOption);
            }}
          >
            <PlusIcon />
            New note
          </Button>
        </div>
      </TopBar>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
        {rows.length === 0 && !grouped ? (
          <div className="flex flex-col items-center justify-center gap-1 p-8 text-center">
            <p className="m-0 text-subtitle font-medium">This list is empty</p>
            <p className="m-0 text-body text-muted-foreground">
              Add a note, or move items here, and they show in its groups.
            </p>
          </div>
        ) : (
          groups.map(({ option, rows: held }) => (
            <ListGroup
              key={option ?? ""}
              option={option}
              rows={held}
              openItem={openItem}
              placing={placing}
              grouped={grouped}
              onNew={(picked) => {
                void newNote(picked);
              }}
            />
          ))
        )}
      </div>
    </div>
  );
};
