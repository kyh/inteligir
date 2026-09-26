import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { EDITOR_PAGE_FOLDER } from "../page-folder";

// the plugin is a CommonJS module expo requires, not one this program imports
const plugin = z
  .looseObject({ EDITOR_PAGE_FOLDER: z.string() })
  .parse(createRequire(import.meta.url)("../../../plugins/with-editor-page.js"));

describe("the editor page's folder in the app bundle", () => {
  it("is the folder the config plugin puts the page in", () => {
    expect(plugin.EDITOR_PAGE_FOLDER).toBe(EDITOR_PAGE_FOLDER);
  });
});
