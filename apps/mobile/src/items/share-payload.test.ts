import { describe, expect, it } from "vitest";
import { redirectSystemPath } from "../app/+native-intent";
import { isShareHandoff, sharedSaveOf, unreadLink } from "./share-payload";

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

  it("keeps the text that came with a link as its note, and names an unread link by short text", () => {
    expect(sharedSaveOf({ meta: null, text: "File over app", webUrl: URL })).toStrictEqual({
      kind: "link",
      note: "File over app",
      title: null,
      url: URL,
    });
    const long = "Read this before the meeting.\nIt explains why we keep everything in files.";
    expect(sharedSaveOf({ meta: {}, text: long, webUrl: URL })).toStrictEqual({
      kind: "link",
      note: long,
      title: null,
      url: URL,
    });
    expect(
      unreadLink({ kind: "link", note: "File over app", title: null, url: URL }),
    ).toStrictEqual({ kind: "link", note: null, title: "File over app", url: URL });
    const words = { kind: "link", note: long, title: null, url: URL } as const;
    expect(unreadLink(words)).toStrictEqual(words);
    const titled = {
      kind: "link",
      note: "For Tuesday.",
      title: "File over app",
      url: URL,
    } as const;
    expect(unreadLink(titled)).toStrictEqual(titled);
  });

  it("takes every spelling of the shared link out of its text, and makes no title of a link", () => {
    const shared = "https://example.com/a";
    for (const text of [`${shared}/`, `${shared}?utm_source=x`, ` ${shared} . `]) {
      expect(sharedSaveOf({ meta: null, text, webUrl: shared })).toStrictEqual({
        kind: "link",
        note: null,
        title: null,
        url: shared,
      });
    }
    expect(
      sharedSaveOf({ meta: null, text: "Breaking: thing https://t.co/abc", webUrl: shared }),
    ).toStrictEqual({
      kind: "link",
      note: "Breaking: thing https://t.co/abc",
      title: null,
      url: shared,
    });
  });

  it("leaves the sentence's punctuation out of a link found in text, and its own marks in", () => {
    expect(
      sharedSaveOf({
        meta: null,
        text: "Worth a look https://example.com/z.",
        webUrl: "https://example.com/z.",
      }),
    ).toStrictEqual({
      kind: "link",
      note: "Worth a look",
      title: null,
      url: "https://example.com/z",
    });
    const own = "https://example.com/it's_(here)";
    expect(sharedSaveOf({ meta: null, text: null, webUrl: own })).toStrictEqual({
      kind: "link",
      note: null,
      title: null,
      url: own,
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
      expect(
        redirectSystemPath({ initial, path: "/item/0190a000-0000-7000-8000-000000000001" }),
      ).toBe("/item/0190a000-0000-7000-8000-000000000001");
    }
    expect(isShareHandoff("dataUrl=inteligirShareKey")).toBe(true);
    expect(isShareHandoff("inteligir://item/dataUrl=x")).toBe(false);
  });
});
