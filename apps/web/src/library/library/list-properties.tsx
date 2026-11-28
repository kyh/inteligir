import { listSettingsSchema } from "@repo/contract/library/library-item";
import type { ListSettings } from "@repo/contract/library/library-item";
import { Button } from "@repo/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@repo/ui/components/dropdown-menu";
import { Input } from "@repo/ui/components/input";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui/components/popover";
import { toast } from "@repo/ui/components/sonner";
import { ToggleChip, ToggleGroup } from "@repo/ui/components/toggle-group";
import { useMutation } from "@tanstack/react-query";
import {
  Sliders04 as SlidersHorizontalIcon,
  Trash01 as Trash2Icon,
  XClose as XIcon,
} from "@untitledui/icons";
import { useState } from "react";
import type { KeyboardEvent } from "react";
import { z } from "zod";

import { useLibraryWrites } from "../cloud/library-context";

type ListProperty = ListSettings["properties"][number];

type PropertyType = ListProperty["type"];

const TYPE_LABELS = {
  select: "Select",
  text: "Text",
  url: "Link",
} satisfies Record<PropertyType, string>;

const PROPERTY_TYPES = ["select", "text", "url"] as const satisfies readonly PropertyType[];

const NO_GROUP = "";

const typeNamed = (value: string) => PROPERTY_TYPES.find((type) => type === value) ?? null;

const picked = z.string();

const onEnter = (act: () => void) => (event: KeyboardEvent<HTMLInputElement>) => {
  if (event.key === "Enter") {
    event.preventDefault();
    act();
  }
};

const renamedProperty = (property: ListProperty, name: string) =>
  ({ ...property, name }) satisfies ListProperty;

const withOptions = (property: ListProperty, options: readonly string[]) =>
  (property.type === "select"
    ? { ...property, options: options.map((name) => ({ name })) }
    : property) satisfies ListProperty;

const newProperty = (name: string, type: PropertyType) => {
  switch (type) {
    case "select": {
      return { name, options: [], type } satisfies ListProperty;
    }

    case "text":
    case "url": {
      return { name, type } satisfies ListProperty;
    }

    default: {
      throw new Error(`unexpected ${String(type satisfies never)}`);
    }
  }
};

interface Shaping {
  readonly list: ListSettings;
  readonly commit: (
    next: ListSettings,
    renames?: readonly { readonly from: string; readonly to: string }[],
  ) => boolean;
}

const PropertyEditor = ({
  property,
  shaping,
}: {
  readonly property: ListProperty;
  readonly shaping: Shaping;
}) => {
  const { commit, list } = shaping;
  const [name, setName] = useState(property.name);
  const [option, setOption] = useState("");

  const replace = (next: ListProperty) =>
    list.properties.map((held) => (held.name === property.name ? next : held));

  const rename = () => {
    const to = name.trim();

    if (to === "" || to === property.name) {
      setName(property.name);

      return;
    }

    const taken = commit(
      {
        groupBy: list.groupBy === property.name ? to : list.groupBy,
        properties: replace(renamedProperty(property, to)),
      },
      [{ from: property.name, to }],
    );

    if (!taken) {
      setName(property.name);
    }
  };

  const options = property.type === "select" ? property.options.map((held) => held.name) : [];

  const addOption = () => {
    const added = option.trim();

    if (added !== "") {
      commit({ ...list, properties: replace(withOptions(property, [...options, added])) });
      setOption("");
    }
  };

  return (
    <div className="flex flex-col gap-1.5" data-list-property={property.name}>
      <div className="flex items-center gap-1.5">
        <Input
          aria-label={`Name of ${property.name}`}
          value={name}
          className="h-7 flex-1 text-body"
          onChange={(event) => {
            setName(event.currentTarget.value);
          }}
          onBlur={rename}
          onKeyDown={onEnter(rename)}
        />
        <span className="w-12 shrink-0 text-caption text-muted-foreground">
          {TYPE_LABELS[property.type]}
        </span>
        <Button
          size="icon-compact"
          variant="ghost"
          className="size-6 shrink-0"
          aria-label={`Delete ${property.name}`}
          onClick={() => {
            commit({
              groupBy: list.groupBy === property.name ? null : list.groupBy,
              properties: list.properties.filter((held) => held.name !== property.name),
            });
          }}
        >
          <Trash2Icon />
        </Button>
      </div>
      {property.type === "select" ? (
        <div className="flex flex-wrap items-center gap-1 pl-1">
          {options.map((held) => (
            <span
              key={held}
              className="inline-flex h-6 items-center gap-1 rounded-full border border-border pr-1 pl-2 text-caption"
            >
              {held}
              <button
                type="button"
                aria-label={`Remove ${held}`}
                className="flex size-4 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                onClick={() => {
                  commit({
                    ...list,
                    properties: replace(
                      withOptions(
                        property,
                        options.filter((kept) => kept !== held),
                      ),
                    ),
                  });
                }}
              >
                <XIcon size={10} />
              </button>
            </span>
          ))}
          <Input
            aria-label={`New option for ${property.name}`}
            placeholder="Add an option"
            value={option}
            className="h-6 w-28 text-caption"
            onChange={(event) => {
              setOption(event.currentTarget.value);
            }}
            onKeyDown={onEnter(addOption)}
          />
        </div>
      ) : null}
    </div>
  );
};

const AddProperty = ({ shaping }: { readonly shaping: Shaping }) => {
  const { commit, list } = shaping;
  const [name, setName] = useState("");
  const [type, setType] = useState<PropertyType>("select");

  const add = () => {
    const named = name.trim();

    if (named === "") {
      return;
    }

    commit({ ...list, properties: [...list.properties, newProperty(named, type)] });
    setName("");
  };

  return (
    <div className="flex flex-col gap-1.5 border-t border-border pt-3">
      <p className="m-0 text-caption text-muted-foreground">Add a property</p>
      <Input
        aria-label="New property name"
        placeholder="Name"
        value={name}
        className="h-7 text-body"
        onChange={(event) => {
          setName(event.currentTarget.value);
        }}
        onKeyDown={onEnter(add)}
      />
      <div className="flex items-center justify-between gap-2">
        <ToggleGroup
          aria-label="New property type"
          value={[type]}
          onValueChange={(values) => {
            const chosen = typeNamed(values[0] ?? "");

            if (chosen !== null) {
              setType(chosen);
            }
          }}
        >
          {PROPERTY_TYPES.map((option) => (
            <ToggleChip key={option} value={option}>
              {TYPE_LABELS[option]}
            </ToggleChip>
          ))}
        </ToggleGroup>
        <Button size="compact" variant="secondary" disabled={name.trim() === ""} onClick={add}>
          Add
        </Button>
      </div>
    </div>
  );
};

const GroupByMenu = ({ shaping }: { readonly shaping: Shaping }) => {
  const { commit, list } = shaping;
  const selects = list.properties.filter((property) => property.type === "select");

  return (
    <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
      <span className="text-caption text-muted-foreground">Group by</span>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button size="compact" variant="ghost" aria-label="Group by" />}
        >
          {list.groupBy ?? "None"}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuRadioGroup
            value={list.groupBy ?? NO_GROUP}
            onValueChange={(value) => {
              const chosen = picked.safeParse(value);

              if (chosen.success) {
                commit({ ...list, groupBy: chosen.data === NO_GROUP ? null : chosen.data });
              }
            }}
          >
            <DropdownMenuRadioItem value={NO_GROUP}>None</DropdownMenuRadioItem>
            {selects.map(({ name }) => (
              <DropdownMenuRadioItem key={name} value={name}>
                {name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

export const ListProperties = ({
  listId,
  list,
}: {
  readonly listId: string;
  readonly list: ListSettings;
}) => {
  const setList = useMutation(useLibraryWrites().setList());

  const shaping: Shaping = {
    commit: (next, renames = []) => {
      const read = listSettingsSchema.safeParse(next);

      if (!read.success) {
        toast.error("Each property and option needs a name of its own.");

        return false;
      }

      setList.mutate({
        id: listId,
        list: read.data,
        opId: crypto.randomUUID(),
        renames: [...renames],
      });

      return true;
    },
    list,
  };

  return (
    <Popover>
      <PopoverTrigger render={<Button size="compact" variant="ghost" />}>
        <SlidersHorizontalIcon />
        Properties
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-3">
        <p className="m-0 text-subtitle font-medium">Properties</p>
        {list.properties.length === 0 ? (
          <p className="m-0 text-body text-muted-foreground">
            Give this list’s notes properties to fill in and group by.
          </p>
        ) : (
          list.properties.map((property) => (
            <PropertyEditor key={property.name} property={property} shaping={shaping} />
          ))
        )}
        <AddProperty shaping={shaping} />
        <GroupByMenu shaping={shaping} />
      </PopoverContent>
    </Popover>
  );
};
