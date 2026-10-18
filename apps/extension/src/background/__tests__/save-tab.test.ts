import { BROWSER_WIRE_VERSION, CAPTURE_HTML_MAX_CHARS } from "@repo/contract/browser/browser-wire";
import type { CapturedPageWire } from "@repo/contract/browser/browser-wire";
import { describe, expect, it } from "vitest";
import type { CaptureOptions } from "@/capture/serialize-page";
import { outcomeOf, planTabSave } from "@/background/save-tab";

const tab = { id: 7, title: "An article", url: "https://example.test/a" };

const page: CapturedPageWire = {
  html: "<!doctype html>\n<html></html>",
  selection: { text: "a passage" },
  title: "An article",
  url: "https://example.test/a",
};

const unscriptable = async (): Promise<CapturedPageWire | null> => null;
const scripted = async (): Promise<CapturedPageWire | null> => page;

describe("saving a tab", () => {
  it("captures it with the wire's cap and saves the page it read", async () => {
    const asked: CaptureOptions[] = [];
    const plan = await planTabSave({
      capture: async (tabId, options) => {
        expect(tabId).toBe(7);
        asked.push(options);
        return page;
      },
      keepCopy: true,
      tab,
    });
    expect(asked).toEqual([{ htmlMaxChars: CAPTURE_HTML_MAX_CHARS, keepCopy: true }]);
    expect(plan).toEqual({ kind: "save", save: { keepCopy: true, page, target: "page" } });
  });

  it("saves a page it cannot script by its address, and a selection Chrome read for the Mac to place", async () => {
    expect(await planTabSave({ capture: unscriptable, keepCopy: false, tab })).toEqual({
      kind: "save",
      save: { target: "link", title: "An article", url: "https://example.test/a" },
    });
    expect(
      await planTabSave({
        capture: unscriptable,
        keepCopy: false,
        selectionText: " a passage ",
        tab,
      }),
    ).toEqual({
      kind: "save",
      save: {
        keepCopy: false,
        page: {
          html: null,
          selection: { text: "a passage" },
          title: "An article",
          url: "https://example.test/a",
        },
        target: "page",
      },
    });
  });

  it("saves nothing off the web", async () => {
    for (const url of ["chrome://settings", "file:///etc/hosts", undefined]) {
      expect(
        await planTabSave({ capture: scripted, keepCopy: false, tab: { ...tab, url } }),
      ).toEqual({
        kind: "unsupported",
      });
    }
  });

  it("reads the host's answers as the pages' outcomes", () => {
    const v = BROWSER_WIRE_VERSION;
    expect(outcomeOf({ kind: "absent" })).toEqual({
      detail: "",
      kind: "refused",
      reason: "absent",
    });
    expect(outcomeOf({ kind: "forbidden" })).toMatchObject({ reason: "update-app" });
    expect(outcomeOf({ detail: "gone", kind: "crashed" })).toEqual({
      detail: "gone",
      kind: "refused",
      reason: "failed",
    });
    expect(
      outcomeOf({
        kind: "reply",
        reply: { appVersion: "1.0.0", library: "Inteligir", type: "hello", v },
      }),
    ).toEqual({ appVersion: "1.0.0", kind: "hello", library: "Inteligir" });
    expect(
      outcomeOf({ kind: "reply", reply: { detail: "x", reason: "too-large", type: "refused", v } }),
    ).toEqual({ detail: "x", kind: "refused", reason: "too-large" });
  });
});
