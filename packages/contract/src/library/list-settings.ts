import { z } from "zod";

import type { JsonValue } from "./canonical-json";
import type { ListSettings } from "./library-item";

export const NEW_LIST: ListSettings = {
  groupBy: "Status",
  properties: [
    {
      name: "Status",
      options: [{ name: "To do" }, { name: "In progress" }, { name: "Done" }],
      type: "select",
    },
  ],
};

const propertyOf = (list: ListSettings, name: string) =>
  list.properties.find((property) => property.name === name) ?? null;

interface ListGroup<T> {
  readonly option: string | null;
  readonly items: readonly T[];
}

const optionValue = z.string();

export const groupsOf = <T extends { readonly properties: Readonly<Record<string, JsonValue>> }>(
  list: ListSettings,
  items: readonly T[],
) => {
  const property = list.groupBy === null ? null : propertyOf(list, list.groupBy);

  if (property?.type !== "select") {
    return [{ items, option: null }] satisfies ListGroup<T>[];
  }

  const names = property.options.map(({ name }) => name);
  const byOption = new Map<string | null, T[]>([...names, null].map((name) => [name, []]));

  for (const item of items) {
    const value = optionValue.safeParse(item.properties[property.name]);
    const option = value.success && names.includes(value.data) ? value.data : null;
    byOption.get(option)?.push(item);
  }

  return [...byOption].flatMap(([option, held]) =>
    option === null && held.length === 0 ? [] : [{ items: held, option }],
  ) satisfies ListGroup<T>[];
};

export interface PropertyRename {
  readonly from: string;
  readonly to: string;
}

export const renamedProperties = <V>(
  properties: Readonly<Record<string, V>>,
  renames: readonly PropertyRename[],
) => {
  const from = new Set(renames.map((rename) => rename.from));
  const renamed: Record<string, V> = {};

  for (const [key, value] of Object.entries(properties)) {
    if (!from.has(key)) {
      renamed[key] = value;
    }
  }

  const held = new Map(Object.entries(properties));

  for (const rename of renames) {
    const value = held.get(rename.from);

    if (value !== undefined) {
      renamed[rename.to] = value;
    }
  }

  return renamed;
};
