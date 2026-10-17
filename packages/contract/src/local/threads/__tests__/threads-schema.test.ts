import type { LibraryViewContext, ViewContext } from "@repo/domain/view-context";
import { describe, expect, it } from "vitest";
import {
  encodeThreadListCursor,
  listThreadsQuerySchema,
  sendMessageRequestSchema,
} from "../threads-schema";

describe("the thread listing's cursor", () => {
  it.each([
    { archived: false, id: "thr_2345abcdef", updatedAt: 1_700_000_000_000 },
    { archived: true, id: "thr.with.dots", updatedAt: 0 },
  ])("reads back the position it was minted from ($id)", (position) => {
    const parsed = listThreadsQuerySchema.parse({ cursor: encodeThreadListCursor(position) });
    expect(parsed.cursor).toEqual(position);
  });

  it.each(["", "x.1.thr_a", "l.1", "l..thr_a", "l.99999999999999999.thr_a", "l.1."])(
    "refuses %j, which no listing answered",
    (cursor) => {
      expect(listThreadsQuerySchema.safeParse({ cursor }).success).toBe(false);
    },
  );
});

const send = (viewContext: ViewContext) =>
  sendMessageRequestSchema.safeParse({ text: "Tidy these", threadId: "thr_1", viewContext });

describe("a send's view context", () => {
  const library: LibraryViewContext = {
    paths: ["Reading//a.md", "Reading/b.md"],
    scope: { kind: "folder", path: "Reading" },
    selected: 7,
    surface: "library",
  };

  it("keeps a doc's resource as a vault path and its revision as a content hash", () => {
    const doc: ViewContext = {
      resource: "notes/Week.md",
      revision: "c".repeat(64),
      surface: "doc",
    };
    expect(send(doc).success).toBe(true);
    expect(send({ ...doc, resource: "../etc/passwd" }).success).toBe(false);
    expect(send({ ...doc, revision: "HEAD" }).success).toBe(false);
  });

  it("reads the library's scope and selection, each path normalized as a vault path", () => {
    const parsed = send(library);
    expect(parsed.success && parsed.data.viewContext).toEqual({
      ...library,
      paths: ["Reading/a.md", "Reading/b.md"],
    });
    expect(send({ ...library, kinds: ["link", "pdf"], q: "files" }).success).toBe(true);
    expect(
      send({ paths: [], scope: { kind: "all" }, selected: 0, surface: "library" }).success,
    ).toBe(true);
  });

  const refusals: [string, Partial<LibraryViewContext>][] = [
    ["the Deleted scope", { scope: { kind: "deleted" } }],
    ["a folder outside the vault", { scope: { kind: "folder", path: "../out" } }],
    ["a tag that is not a tag name", { scope: { kind: "tag", tag: "two words" } }],
    ["a kind no item has", { kinds: ["graph"] }],
    ["a path outside the vault", { paths: ["../a.md"] }],
    ["an item named twice", { paths: ["Reading/a.md", "Reading//a.md"] }],
    ["fewer selected than it names", { selected: 1 }],
  ];
  it.each(refusals)("refuses %s", (_reason, change) => {
    expect(send({ ...library, ...change }).success).toBe(false);
  });
});
