import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { redirectSystemPath } from "../app/+native-intent";
import { isShareHandoff, sharedSaveOf, unreadLink } from "./share-payload";
import type { ShareHandoff } from "./share-payload";

const URL = "https://stephango.com/file-over-app";

// the search `parseShareIntent` runs over shared text, read out of the installed library, whose
// module needs a native runtime to load: the app is handed the first http match
const libraryBuild = readFileSync(
  createRequire(import.meta.url).resolve("expo-share-intent/build/utils.js"),
  "utf-8",
);
const ADDRESS_SEARCH = new RegExp(
  /\.text\s+\.match\(\/(?<search>.+)\/gi\)/u.exec(libraryBuild)?.groups?.search ?? "",
  "giu",
);

const textShare = (text: string): ShareHandoff => ({
  meta: null,
  text,
  webUrl: text.match(ADDRESS_SEARCH)?.find((link) => link.startsWith("http")) ?? null,
});

// `parseShareIntent` hands a page's address over as both
const pageShare = (url: string): ShareHandoff => ({ meta: null, text: url, webUrl: url });

describe("what a share asks the phone to save", () => {
  it("takes a page's title from its meta, and the text beside the link as its note", () => {
    expect(sharedSaveOf({ ...pageShare(URL), meta: { title: " File over app " } })).toStrictEqual({
      kind: "link",
      note: null,
      title: "File over app",
      url: URL,
    });
    expect(
      sharedSaveOf({ ...pageShare(URL), meta: { "og:title": "File over app", title: "" } }),
    ).toStrictEqual({ kind: "link", note: null, title: "File over app", url: URL });
    expect(sharedSaveOf(textShare(`For Tuesday. ${URL}`))).toStrictEqual({
      kind: "link",
      note: "For Tuesday.",
      title: null,
      url: URL,
    });
  });

  it.each([
    "https://en.wikipedia.org/wiki/Oklahoma!",
    "https://en.wikipedia.org/wiki/Jeopardy!",
    "https://en.wikipedia.org/wiki/Washington,_D.C.",
    "https://en.wikipedia.org/wiki/Foo_(bar)",
    "https://en.wikipedia.org/wiki/Bar)",
    "https://example.com/it's",
    "https://example.com/a?q=why?",
  ])("keeps a shared page's address to its last character: %s", (url) => {
    expect(sharedSaveOf(pageShare(url))).toStrictEqual({
      kind: "link",
      note: null,
      title: null,
      url,
    });
  });

  it.each([
    [
      "Read https://en.wikipedia.org/wiki/Mercury_(planet) tonight",
      "https://en.wikipedia.org/wiki/Mercury_(planet)",
      "Read tonight",
    ],
    ["Read https://example.com/a,b tonight", "https://example.com/a,b", "Read tonight"],
    ["Read https://example.com/café/menu tonight", "https://example.com/café/menu", "Read tonight"],
    ["Worth a look https://example.com/z.", "https://example.com/z", "Worth a look"],
    ['see "https://example.com/z" now', "https://example.com/z", "see now"],
    ["see “https://example.com/z” now", "https://example.com/z", "see now"],
    ["see 'https://example.com/z' now", "https://example.com/z", "see now"],
    ["see ‘https://example.com/z’ now", "https://example.com/z", "see now"],
    ['read "https://example.com/z".', "https://example.com/z", "read"],
    ["read “https://example.com/z”.", "https://example.com/z", "read"],
    ["“https://example.com/z”", "https://example.com/z", null],
    ["(see https://example.com/z)", "https://example.com/z", "see"],
    ["(see https://example.com/z) for more", "https://example.com/z", "see for more"],
    ["Read <https://example.com/z> tonight", "https://example.com/z", "Read tonight"],
  ])("reads the link inside text whole, and the words around it: %s", (text, url, note) => {
    expect(sharedSaveOf(textShare(text))).toStrictEqual({ kind: "link", note, title: null, url });
  });

  it("keeps the lines of a long note around the link", () => {
    const before = "Read this before the meeting.";
    const after = "It explains why we keep everything in files.";
    for (const [text, note] of [
      [`${before}\n${URL}\n${after}`, `${before}\n${after}`],
      [`${before}\n\n${URL}\n\n${after}`, `${before}\n\n${after}`],
      [`${before}\n\n${URL} ${after}`, `${before}\n\n${after}`],
      [`${before} ${URL}\n${after}`, `${before}\n${after}`],
      [`${before}\n${after}\n${URL}`, `${before}\n${after}`],
    ] as const) {
      expect(sharedSaveOf(textShare(text))).toStrictEqual({
        kind: "link",
        note,
        title: null,
        url: URL,
      });
    }
  });

  it("names an unread link by short words beside it, never by the marks around the link", () => {
    const named = { kind: "link", note: null, title: "see", url: "https://example.com/z" };
    const shared = sharedSaveOf(textShare("(see https://example.com/z)"));
    expect(shared.kind === "link" ? unreadLink(shared) : null).toStrictEqual(named);
    const long = `Read this before the meeting.\nIt explains why we keep everything in files.`;
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
    for (const text of [
      `${shared} ${shared}/`,
      `${shared} (${shared}?utm_source=x).`,
      `${shared} “${shared}/”`,
      `${shared} . `,
    ]) {
      expect(sharedSaveOf(textShare(text))).toStrictEqual({
        kind: "link",
        note: null,
        title: null,
        url: shared,
      });
    }
    const other = sharedSaveOf(textShare(`Breaking: ${shared} and https://t.co/abc`));
    expect(other).toStrictEqual({
      kind: "link",
      note: "Breaking: and https://t.co/abc",
      title: null,
      url: shared,
    });
    expect(other.kind === "link" ? unreadLink(other) : null).toStrictEqual(other);
  });

  it("takes the extension's address when the text's link reads as none", () => {
    expect(sharedSaveOf(textShare("https://) and https://example.com/a"))).toStrictEqual({
      kind: "link",
      note: "https://) and",
      title: null,
      url: "https://example.com/a",
    });
  });

  it("hands text alone to the text save, which finds a link inside it", () => {
    expect(sharedSaveOf(textShare("  a thought  "))).toStrictEqual({
      kind: "text",
      text: "a thought",
    });
    expect(sharedSaveOf(textShare("(https://example.com/z)"))).toStrictEqual({
      kind: "text",
      text: "(https://example.com/z)",
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
