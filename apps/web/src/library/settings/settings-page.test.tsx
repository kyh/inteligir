// @vitest-environment jsdom

import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppRouter } from "../test-support/library-router";
import { createPageQueryClient } from "../cloud/v1";
import { fakePageLibrary } from "../test-support/fake-page-library";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// the whole page, over a cell's wire
const openedAtSettings = async () => {
  const { library } = fakePageLibrary({ answer: () => ({ assistants: [], devices: [] }) });
  const router = createAppRouter(createMemoryHistory({ initialEntries: ["/library/settings"] }), {
    library,
    queryClient: createPageQueryClient(),
  });
  render(<RouterProvider router={router} />);
  await screen.findByRole("heading", { name: "Settings" });
  return router;
};

describe("Settings' sections", () => {
  it("moves to a section and leaves the address, which is the route, alone", async () => {
    const router = await openedAtSettings();
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");

    fireEvent.click(
      within(screen.getByRole("navigation", { name: "Settings" })).getByText("Editor"),
    );

    await vi.waitFor(() => {
      expect(scrolled.mock.contexts).toContain(document.querySelector("#editor"));
    });
    expect(router.history.location.pathname).toBe("/library/settings");
    expect(router.history.location.hash).toBe("");
    expect(screen.getByRole("heading", { name: "Settings" })).toBeDefined();
  });
});
