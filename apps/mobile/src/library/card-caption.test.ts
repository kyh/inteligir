import type { LibraryItemFields } from "@repo/contract/library/library-item";
import { describe, expect, it } from "vitest";

import { cardCaption } from "./card-caption";

const SAVED = Date.UTC(2026, 9, 2, 12);

const caption = (fields: Pick<LibraryItemFields, "reading" | "site">): string =>
  cardCaption({ fields: { ...fields, savedAt: SAVED } });

describe("a Library row's caption", () => {
  it("says a link waits for the cloud's read, and that the read failed", () => {
    expect(caption({ reading: { at: null, state: "pending" }, site: null })).toBe(
      "Waiting to be read",
    );
    expect(
      caption({ reading: { at: SAVED, error: "Gone.", state: "failed" }, site: "example.com" }),
    ).toBe("Page not read");
  });

  it("names a read link's site and the day it was saved, and a note's day alone", () => {
    const day = new Date(SAVED).toLocaleDateString();
    expect(caption({ reading: { at: SAVED, state: "read" }, site: "example.com" })).toBe(
      `example.com · ${day}`,
    );
    expect(caption({ reading: { state: "none" }, site: null })).toBe(day);
  });
});
