import { isContainerKind } from "@repo/contract/items/item-kind";
import type { ItemKind } from "@repo/contract/items/item-kind";
import { lineOf, parentRefusal } from "@repo/contract/library/cell-rules";
import type { ParentNode, ParentTarget } from "@repo/contract/library/cell-rules";
import { titleKey } from "@repo/contract/library/derive-item";
import { noteFields } from "@repo/contract/library/item-makes";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import { FOLDER_NAME_MAX, folderPathNames } from "@repo/contract/library/library-wire";
import { item } from "@repo/db/library-schema";
import { and, eq, inArray, or } from "drizzle-orm";

import { mintLibraryId } from "./library-ids";
import { landNewItems } from "./library-landing";
import { refuse } from "./library-refusal";
import type { WriteScope } from "./library-store";

interface HeldParent extends ParentNode {
  readonly id: string;
  readonly title: string;
}

export interface ParentChild {
  readonly id: string;
  readonly kind: ItemKind;
}

const PARENT_KINDS = ["folder", "list", "note"] as const satisfies readonly ItemKind[];

const heldParents = async (scope: WriteScope, also: string | null = null) => {
  const rows = await scope.tx
    .select({
      deletedAt: item.deletedAt,
      id: item.id,
      kind: item.kind,
      parentId: item.parentId,
      title: item.title,
    })
    .from(item)
    .where(
      and(
        eq(item.accountId, scope.accountId),
        or(inArray(item.kind, [...PARENT_KINDS]), also === null ? undefined : eq(item.id, also)),
      ),
    );

  return new Map<string, HeldParent>(rows.map((row) => [row.id, row]));
};

const liveParentOf = (held: ReadonlyMap<string, HeldParent>, parentId: string | null) =>
  parentId !== null && held.get(parentId)?.deletedAt === null ? parentId : null;

const folderNamed = (
  held: ReadonlyMap<string, HeldParent>,
  parentId: string | null,
  name: string,
) =>
  [...held.values()].find(
    (row) =>
      row.kind === "folder" &&
      row.deletedAt === null &&
      liveParentOf(held, row.parentId) === parentId &&
      titleKey(row.title) === titleKey(name),
  );

const folderAtPath = async (scope: WriteScope, held: Map<string, HeldParent>, path: string) => {
  let parentId: string | null = null;

  for (const written of folderPathNames(path)) {
    const name = written.slice(0, FOLDER_NAME_MAX).trim();

    const found = folderNamed(held, parentId, name);

    if (found === undefined) {
      const id = mintLibraryId(scope.now);

      const fields: LibraryItemFields = {
        ...noteFields({ parentId, savedAt: scope.now, tags: [], title: name }),
        kind: "folder",
      };

      const [landed] = await landNewItems(scope, [{ blocks: [], fields, id }]);

      if (landed === undefined || !landed.ok) {
        return refuse(landed?.refusal ?? { kind: "conflict" });
      }

      held.set(id, { deletedAt: null, id, kind: "folder", parentId, title: name });
      parentId = id;
    } else {
      parentId = found.id;
    }
  }

  return parentId;
};

export const parentOfTarget = async (
  scope: WriteScope,
  target: ParentTarget | undefined,
  children: readonly ParentChild[],
) => {
  if (target === undefined || target === null) {
    return target;
  }

  const held = await heldParents(scope, "id" in target ? target.id : null);
  const parentId = "id" in target ? target.id : await folderAtPath(scope, held, target.path);
  const reader = { item: (id: string) => held.get(id) ?? null };

  for (const child of children) {
    const refusal = parentRefusal(reader, child, parentId);

    if (refusal !== null) {
      return refuse({ kind: refusal });
    }
  }

  return parentId;
};

export const sweepParent = async (
  scope: WriteScope,
  target: ParentTarget | undefined,
  ids: readonly string[],
) => {
  const parentId = await parentOfTarget(scope, target, []);

  if (parentId === undefined || parentId === null) {
    return { ids, parentId };
  }

  const held = await heldParents(scope);
  const above = lineOf({ item: (id) => held.get(id) ?? null }, parentId);

  return { ids: ids.filter((id) => !above.has(id)), parentId };
};

export const containersUnder = async (scope: WriteScope, ids: readonly string[]) => {
  const held = await heldParents(scope);
  const found = [...ids];

  for (const id of found) {
    for (const row of held.values()) {
      if (
        row.parentId === id &&
        row.deletedAt === null &&
        isContainerKind(row.kind) &&
        !found.includes(row.id)
      ) {
        found.push(row.id);
      }
    }
  }

  return found;
};
