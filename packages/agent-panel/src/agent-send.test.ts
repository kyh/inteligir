import { agentViewContextSchema } from "@repo/contract/cloud/library/library-wire";
import { LIBRARY_SELECTION_MAX } from "@repo/domain/view-context";
import { describe, expect, it } from "vitest";

import { composerPlaceholder, sendInput, viewContextOf } from "./agent-send";
import { TIDY_PLACEHOLDER, TIDY_VIEW_CONTEXT, tidyMessage } from "./tidy-library";

const ITEM = "0199a4c2-0000-7000-8000-0000000000a1";
const THREAD = "0199a4c2-0000-7000-8000-000000000001";

const ids = (count: number): string[] =>
  Array.from(
    { length: count },
    (_, index) => `0199a4c2-0000-7000-8000-${String(index).padStart(12, "0")}`,
  );

describe("the screen a message leaves from", () => {
  it("is the open item whatever the library shows", () => {
    expect(
      viewContextOf({ kind: "link", openItem: ITEM, scope: { kind: "all" }, selected: ids(2) }),
    ).toEqual({ itemId: ITEM, surface: "item" });
  });

  it("is the scope, its kind and the first of the selection, counted whole", () => {
    const context = viewContextOf({
      kind: "link",
      openItem: null,
      scope: { kind: "unsorted" },
      selected: ids(LIBRARY_SELECTION_MAX + 3),
    });
    expect(context).toEqual({
      itemIds: ids(LIBRARY_SELECTION_MAX),
      kinds: ["link"],
      scope: { kind: "unsorted" },
      selected: LIBRARY_SELECTION_MAX + 3,
      surface: "library",
    });
    expect(agentViewContextSchema.parse(context)).toEqual(context);
  });

  it("names no kind when the library is not narrowed to one, and nothing from Deleted", () => {
    expect(
      viewContextOf({ kind: null, openItem: null, scope: { kind: "all" }, selected: [] }),
    ).toEqual({ itemIds: [], scope: { kind: "all" }, selected: 0, surface: "library" });
    expect(
      viewContextOf({ kind: null, openItem: null, scope: { kind: "deleted" }, selected: ids(1) }),
    ).toBeUndefined();
  });
});

describe("what the composer sends", () => {
  it("sends the person's words on the thread open, from the screen they left", () => {
    const viewContext = { itemId: ITEM, surface: "item" } as const;
    expect(
      sendInput({ text: "  File this. ", threadId: THREAD, tidying: false, viewContext }),
    ).toEqual({ text: "File this.", threadId: THREAD, viewContext });
    expect(
      sendInput({ text: "Hi", threadId: null, tidying: false, viewContext: undefined }),
    ).toEqual({
      text: "Hi",
    });
  });

  it("sends nothing for an empty field", () => {
    expect(
      sendInput({ text: "  ", threadId: null, tidying: false, viewContext: undefined }),
    ).toBeNull();
  });

  it("sends Tidy's request as a new conversation from Unsorted, empty field or not", () => {
    const viewContext = { itemId: ITEM, surface: "item" } as const;
    expect(sendInput({ text: "", threadId: THREAD, tidying: true, viewContext })).toEqual({
      text: tidyMessage(""),
      viewContext: TIDY_VIEW_CONTEXT,
    });
    expect(sendInput({ text: "Skip recipes", threadId: null, tidying: true, viewContext })).toEqual(
      {
        text: tidyMessage("Skip recipes"),
        viewContext: TIDY_VIEW_CONTEXT,
      },
    );
  });

  it("says what the field asks for", () => {
    expect(composerPlaceholder(true, THREAD)).toBe(TIDY_PLACEHOLDER);
    expect(composerPlaceholder(false, null)).toBe("Ask the agent…");
    expect(composerPlaceholder(false, THREAD)).toBe("Reply…");
  });
});
