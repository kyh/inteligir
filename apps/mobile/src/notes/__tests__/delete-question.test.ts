import { describe, expect, it } from "vitest";
import { deleteQuestion } from "../delete-question";

describe("what a delete asks", () => {
  it("names the files only the item shows", () => {
    expect(deleteQuestion("Plan", 0)).toBe("Delete “Plan”?");
    expect(deleteQuestion("Photo", 1)).toBe("Delete “Photo” and the file only it shows?");
    expect(deleteQuestion("Trip", 3)).toBe("Delete “Trip” and the 3 files only it shows?");
  });
});
