import { describe, expect, it } from "vitest";
import { redirectSystemPath } from "../app/+native-intent";
import { isShareHandoff, sharedSaveOf } from "./share-payload";

const URL = "https://stephango.com/file-over-app";

describe("what a share asks the phone to save", () => {
  it("takes a page's title from its meta, and the text beside the link as its note", () => {
    expect(
      sharedSaveOf({
        meta: { title: " File over app " },
        text: `For Tuesday. ${URL}`,
        webUrl: URL,
      }),
    ).toStrictEqual({ kind: "link", note: "For Tuesday.", title: "File over app", url: URL });
    expect(
      sharedSaveOf({ meta: { "og:title": "File over app", title: "" }, text: URL, webUrl: URL }),
    ).toStrictEqual({ kind: "link", note: null, title: "File over app", url: URL });
  });

  it("takes short text that came with a link as its title, and longer text as its note", () => {
    expect(sharedSaveOf({ meta: null, text: "File over app", webUrl: URL })).toStrictEqual({
      kind: "link",
      note: null,
      title: "File over app",
      url: URL,
    });
    const long = "Read this before the meeting.\nIt explains why we keep everything in files.";
    expect(sharedSaveOf({ meta: {}, text: long, webUrl: URL })).toStrictEqual({
      kind: "link",
      note: long,
      title: null,
      url: URL,
    });
  });

  it("hands text alone to the text save, which finds a link inside it", () => {
    expect(sharedSaveOf({ meta: null, text: "  a thought  ", webUrl: null })).toStrictEqual({
      kind: "text",
      text: "a thought",
    });
    expect(sharedSaveOf({ meta: null, text: " ", webUrl: " " })).toStrictEqual({ kind: "nothing" });
  });
});

describe("the share extension's handoff", () => {
  it("lands on the Library rather than an unmatched route, cold and warm", () => {
    for (const initial of [true, false]) {
      expect(
        redirectSystemPath({ initial, path: "inteligir://dataUrl=inteligirShareKey#weburl" }),
      ).toBe("/");
      expect(redirectSystemPath({ initial, path: "/item/Unsorted/Plan.md" })).toBe(
        "/item/Unsorted/Plan.md",
      );
    }
    expect(isShareHandoff("dataUrl=inteligirShareKey")).toBe(true);
    expect(isShareHandoff("inteligir://item/dataUrl=x")).toBe(false);
  });
});
