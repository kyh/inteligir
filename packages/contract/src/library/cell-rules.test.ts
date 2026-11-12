import { describe, expect, it } from "vitest";

import { folderOpLanding, folderOpRefusal } from "./cell-rules";
import type { FolderReader } from "./cell-rules";

const TOP = "01890a5d-ac96-774b-bcce-b302099a8001";
const UNDER = "01890a5d-ac96-774b-bcce-b302099a8002";
const GONE = "01890a5d-ac96-774b-bcce-b302099a8003";
const NEW = "01890a5d-ac96-774b-bcce-b302099a8004";

const row = (
  id: string,
  name: string,
  parentId: string | null,
  deletedAt: number | null = null,
) => ({
  deletedAt,
  id,
  name,
  parentId,
  seq: 1,
  sort: "a0",
});

// Work › Plans, and a deleted folder
const work = row(TOP, "Work", null);
const plans = row(UNDER, "Plans", TOP);
const tree = [work, plans, row(GONE, "Old", null, 5)];
const reader: FolderReader = {
  children: (parentId) =>
    tree.filter((folder) => folder.parentId === parentId && folder.deletedAt === null),
  folder: (id) => tree.find((folder) => folder.id === id) ?? null,
};

describe("a folder op against the tree its writer read", () => {
  it("lands nothing and refuses nothing when it is already true", () => {
    const create = {
      id: TOP,
      name: "Work",
      op: "create",
      parentId: null,
      sort: "a0",
    } satisfies Parameters<typeof folderOpRefusal>[1];
    expect(folderOpRefusal(reader, create)).toBeNull();
    expect(folderOpLanding(reader, create, 9)).toStrictEqual([]);
  });

  it("refuses a folder under itself, a dead parent and a sibling's name", () => {
    expect(
      folderOpRefusal(reader, {
        baseParentId: null,
        id: TOP,
        op: "move",
        parentId: UNDER,
        sort: "a1",
      }),
    ).toStrictEqual({ current: plans, id: UNDER, kind: "conflict" });
    expect(
      folderOpRefusal(reader, { id: NEW, name: "New", op: "create", parentId: GONE, sort: "a1" }),
    ).toStrictEqual({ kind: "not-found" });
    expect(
      folderOpRefusal(reader, { id: NEW, name: "work", op: "create", parentId: null, sort: "a1" }),
    ).toStrictEqual({ current: work, id: TOP, kind: "conflict" });
  });

  it("deletes the folders under the one it deletes", () => {
    const landed = folderOpLanding(reader, { id: TOP, op: "delete" }, 9);
    expect(landed.map(({ deletedAt, id }) => ({ deletedAt, id }))).toStrictEqual([
      { deletedAt: 9, id: TOP },
      { deletedAt: 9, id: UNDER },
    ]);
  });
});
