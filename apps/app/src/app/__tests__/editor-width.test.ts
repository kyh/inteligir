import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "../../../../..");
const sourceOf = (relative: string): string => readFileSync(join(REPO_ROOT, relative), "utf8");

const TOKEN = "--editor-width";

/** Every column that has to line up on the measure. The editor column now
 * centers itself (editor-chrome's EDITOR_COLUMN_PX); aligning the dock to it
 * is the skin pass's work (#593). */
const CONSUMERS = ["apps/app/src/app/chat/chat-dock.tsx"];

describe("the editor measure", () => {
  it("is DEFINED, once, on the one ancestor all three columns share", () => {
    const stylesheet = sourceOf("apps/app/src/styles/globals.css");
    expect(stylesheet).toMatch(new RegExp(`${TOKEN}:\\s*\\S`, "u"));
  });

  it.each(CONSUMERS)("%s reads it and carries no fallback of its own", (relative) => {
    const source = sourceOf(relative);
    expect(source).toContain(TOKEN);
    // A fallback at each use is three values wearing one name: they read as
    // one measure right up until someone changes the definition, which the
    // fallbacks then quietly ignore.
    expect(source).not.toMatch(new RegExp(`${TOKEN}\\s*,`, "u"));
  });
});
