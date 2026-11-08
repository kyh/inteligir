import { describe, expect, it } from "vitest";

import { cardCaption } from "./card-caption";

const SAVED = Date.UTC(2026, 9, 2, 12);

describe("a Library row's caption", () => {
  it("says a link waits for the cloud's read, and that the read failed", () => {
    expect(cardCaption({ fields: { fetchState: "pending", savedAt: SAVED, site: null } })).toBe(
      "Waiting to be read",
    );
    expect(
      cardCaption({ fields: { fetchState: "failed", savedAt: SAVED, site: "example.com" } }),
    ).toBe("Page not read");
  });

  it("names a read link's site and the day it was saved, and a note's day alone", () => {
    const day = new Date(SAVED).toLocaleDateString();
    expect(
      cardCaption({ fields: { fetchState: "filled", savedAt: SAVED, site: "example.com" } }),
    ).toBe(`example.com · ${day}`);
    expect(cardCaption({ fields: { fetchState: "none", savedAt: SAVED, site: null } })).toBe(day);
  });
});
