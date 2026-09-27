import { setTimeout as delay } from "node:timers/promises";
import { getLiveEditor } from "@repo/editor/live-editor";
import { timeoutManager } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { bootThreadHarness } from "inteligir/server/testing";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { routeTree } from "../../routeTree.gen";
import { bootWorkspace, chord } from "./boot-workspace";
import { InertSocket } from "./inert-socket";

// a query's default gcTime: how long an answer nothing observes stays cached
const QUERY_GC_MS = 5 * 60_000;
// long enough for a collection moved to 0ms to have run
const GC_TICK_MS = 50;

// set by a test that plays the window after gcTime has passed, so an answer no surface observes
// is collected at once rather than five minutes on
let collectUnobserved = false;

// installed before any client exists: a provider switched after its first timer cannot cancel it
beforeAll(() => {
  timeoutManager.setTimeoutProvider({
    clearInterval: (id) => {
      clearInterval(Number(id));
    },
    clearTimeout: (id) => {
      clearTimeout(Number(id));
    },
    setInterval: (callback, ms) => setInterval(callback, ms),
    setTimeout: (callback, ms) =>
      setTimeout(callback, collectUnobserved && ms >= QUERY_GC_MS ? 0 : ms),
  });
});

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  collectUnobserved = false;
});

const NOTE = "Plans.md";

const editable = (): HTMLElement => {
  const element = document.querySelector<HTMLElement>('[data-slate-editor="true"]');
  if (element === null) {
    throw new Error("the note's editor is not on screen");
  }
  return element;
};

describe("the ⌘K composer", () => {
  it("hands focus back to the note's editor on Escape", async () => {
    await bootWorkspace({
      note: NOTE,
      seed: async (harness) => {
        await harness.client.vault.write({
          content: "# Plans\n\nFirst line.\n",
          guard: { kind: "overwrite" },
          path: NOTE,
        });
      },
    });
    await waitFor(() => {
      expect(getLiveEditor(NOTE)).not.toBeNull();
    });
    act(() => {
      getLiveEditor(NOTE)?.tf.focus();
    });
    expect(document.activeElement).toBe(editable());

    fireEvent.keyDown(window, chord("k"));
    const field = await screen.findByLabelText("Ask the agent");
    await waitFor(() => {
      expect(document.activeElement).toBe(field);
    });

    fireEvent.keyDown(field, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByLabelText("Ask the agent")).toBeNull();
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(editable());
    });
  });

  it("draws the field at once when the vendors are slow to answer again", async () => {
    collectUnobserved = true;
    const harness = await bootThreadHarness(
      { mode: "manual" },
      { agent: { detail: null, mode: "auto", runtime: "acp" } },
    );
    // an action on the list, so the panel draws no sign-in offer of its own
    await harness.client.threads.create({ title: "Tidy the intro" });
    vi.stubGlobal("WebSocket", InertSocket);
    let statusesAnswered = 0;
    let vendorsStalled = false;
    vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const asksVendors = new URL(url, "http://localhost").pathname.endsWith("/agents/status");
      if (asksVendors && vendorsStalled) {
        return await Promise.withResolvers<Response>().promise;
      }
      const response = await harness.request(url, { ...init, signal: null });
      if (asksVendors) {
        statusesAnswered += 1;
      }
      return response;
    });
    const router = createRouter({
      history: createMemoryHistory({ initialEntries: ["/"] }),
      routeTree,
    });
    render(<RouterProvider router={router} />);
    await screen.findByRole("tablist", { name: "Panel tabs" });

    await waitFor(() => {
      expect(statusesAnswered).toBeGreaterThan(0);
    });
    // the list's loading state draws the sign-in offer a moment; once the action is listed, only
    // the window itself is left to hold the vendors' answer
    await screen.findByText("Tidy the intro");
    await delay(GC_TICK_MS);
    vendorsStalled = true;
    fireEvent.keyDown(window, chord("k"));

    expect(await screen.findByLabelText("Ask the agent")).toBeDefined();
  });
});
