import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";

import { showOutcome, showSaving } from "./badge";

beforeEach(() => {
  fakeBrowser.reset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const TAB = 7;

const badge = async () => await browser.action.getBadgeText({ tabId: TAB });

describe("the toolbar's badge", () => {
  it("shows a landed save's check mark for two seconds", async () => {
    await showOutcome(TAB, { created: true, kind: "saved", title: "File over app" });
    await expect(badge()).resolves.toBe("✓");
    await vi.advanceTimersByTimeAsync(2000);
    await expect(badge()).resolves.toBe("");
  });

  it("never wipes a later save's progress or refusal with an earlier one's clear", async () => {
    await showOutcome(TAB, { created: true, kind: "saved", title: "File over app" });
    await showSaving(TAB);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(badge()).resolves.toBe("…");
    await showOutcome(TAB, { kind: "refused", reason: "unsupported-page" });
    await vi.advanceTimersByTimeAsync(2000);
    await expect(badge()).resolves.toBe("!");
    const title = await browser.action.getTitle({ tabId: TAB });
    expect(title).toBe("Inteligir can't save this kind of page");
  });
});
