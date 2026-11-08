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

  it("shows a check mark for a save that waits for the cloud, and stays on one that waits for a sign-in", async () => {
    await showOutcome(TAB, { kind: "queued", waitsFor: "connection" });
    await expect(badge()).resolves.toBe("✓");
    await showOutcome(TAB, { kind: "queued", waitsFor: "sign-in" });
    await vi.advanceTimersByTimeAsync(2000);
    await expect(badge()).resolves.toBe("!");
    await expect(browser.action.getTitle({ tabId: TAB })).resolves.toBe(
      "Saved once you sign in to Inteligir again",
    );
  });

  it("shows a later save's check mark for its own two seconds", async () => {
    await showOutcome(TAB, { created: true, kind: "saved", title: "File over app" });
    await vi.advanceTimersByTimeAsync(1500);
    await showSaving(TAB);
    await showOutcome(TAB, { created: true, kind: "saved", title: "Second" });
    await vi.advanceTimersByTimeAsync(1000);
    await expect(badge()).resolves.toBe("✓");
    await vi.advanceTimersByTimeAsync(1000);
    await expect(badge()).resolves.toBe("");
  });

  it("clears one tab's check mark on its own, whatever another tab shows", async () => {
    await showOutcome(TAB, { created: true, kind: "saved", title: "File over app" });
    await showSaving(TAB + 1);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(badge()).resolves.toBe("");
    await expect(browser.action.getBadgeText({ tabId: TAB + 1 })).resolves.toBe("…");
  });
});
