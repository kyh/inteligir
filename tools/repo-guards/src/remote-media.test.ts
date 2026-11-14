// Nothing a device draws in an item comes from the web: an image or a video at a web address in a
// note would be fetched the moment a device opens it, a request no person made, and the built-in
// agent writes notes a saved page may have told it to. Each surface's content policy is the one
// wall, so each is held here: the library's page, which a tab and the Mac app's window both show,
// and the phone's editor page.

import { describe, expect, it } from "vitest";
import { sourceOf } from "./repo";

const POLICIES = [
  "apps/mobile/src/editor/page/page-policy.ts",
  "apps/web/src/lib/document-policy.ts",
];

const DIRECTIVES = /(?<name>default|font|frame|img|media)-src"?:?\s*"?(?<sources>[^;"`,]*)/gu;
const LOCAL_SOURCES = new Set(["'none'", "'self'", "blob:", "data:"]);
// the site's policy is built for the origin it answers from, and a path after it names no other host
const OWN_ORIGIN_PATH = /^\$\{url\.origin\}(?:\/|\$\{\w+_PATH\})/u;

const isLocal = (source: string): boolean =>
  LOCAL_SOURCES.has(source) || OWN_ORIGIN_PATH.test(source);

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
      named.filter(({ source }) => !isLocal(source)),
      `${file} lets a device fetch what an item names from the web`,
    ).toStrictEqual([]);
  });
});
