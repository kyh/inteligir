// Nothing a device draws in an item comes from the web: an image or a video at a web address in a
// note would be fetched the moment a device opens it, a request no person made, and the built-in
// agent writes notes a saved page may have told it to. Each surface's content policy is the one
// wall, so each is held here: the tab's, the Mac's and the phone's editor page's.

import { describe, expect, it } from "vitest";
import { sourceOf } from "./repo";

const POLICIES = [
  "apps/desktop/src-tauri/tauri.conf.json",
  "apps/mobile-editor/index.html",
  "apps/web/src/worker/library/library-page.ts",
];

const DIRECTIVES = /(?<name>default|font|frame|img|media)-src"?:?\s*"?(?<sources>[^;",]*)/gu;
const LOCAL_SOURCES = new Set(["'none'", "'self'", "blob:", "data:", "inteligir-files:"]);

describe("what a device draws in an item", () => {
  it.each(POLICIES)("comes from nowhere on the web under %s", (file) => {
    const named = [...sourceOf(file).matchAll(DIRECTIVES)].flatMap(({ groups }) =>
      (groups?.sources ?? "")
        .split(" ")
        .filter((source) => source !== "")
        .map((source) => ({ directive: groups?.name, source })),
    );
    expect(named.length, `${file} names no drawing source this guard can read`).toBeGreaterThan(0);
    expect(
      named.filter(({ source }) => !LOCAL_SOURCES.has(source)),
      `${file} lets a device fetch what an item names from the web`,
    ).toStrictEqual([]);
  });
});
