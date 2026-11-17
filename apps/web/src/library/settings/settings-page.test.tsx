import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { openedOver, renderLibraryAt } from "../test-support/library-page";
import { fakePageLibrary } from "../test-support/fake-page-library";

afterEach(() => {
  vi.restoreAllMocks();
});

// the whole page, over a cell's wire
const openedAtSettings = async () => {
  const { library } = fakePageLibrary({ answer: () => ({ assistants: [], devices: [] }) });
  renderLibraryAt("/library/settings", await openedOver(library));
  await screen.findByRole("heading", { name: "Settings" });
};

describe("Settings' sections", () => {
  it("moves to a section and leaves the address alone", async () => {
    await openedAtSettings();
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");

    fireEvent.click(
      within(screen.getByRole("navigation", { name: "Settings" })).getByText("Editor"),
    );

    await vi.waitFor(() => {
      expect(scrolled.mock.contexts).toContain(document.querySelector("#editor"));
    });
    expect(window.location.pathname).toBe("/library/settings");
    expect(window.location.hash).toBe("");
    expect(screen.getByRole("heading", { name: "Settings" })).toBeDefined();
  });

  it("links the licences from About, opened apart from the tab", async () => {
    await openedAtSettings();

    // the Mac app's window is the tab, with no way back out of a text file
    const link = screen.getByRole("link", { name: "Open-source software Inteligir is built on" });
    expect(link.getAttribute("href")).toBe("/licenses.md");
    expect(link.getAttribute("target")).toBe("_blank");
  });
});
