// @vitest-environment jsdom

import { createFakeCell } from "@repo/library-replica/test-support/fake-cell";
import { openDevice } from "@repo/library-replica/test-support/replica-harness";
import { toast } from "@repo/ui/components/sonner";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppRouter } from "../router";
import { createPageQueryClient } from "./cloud/v1";
import { fakePageLibrary } from "./test-support/fake-page-library";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ADDRESS = "The page's address";

// the whole page at the library, over a replica and a cell's wire, with Save a link's dialog open
const askedToSaveALink = async () => {
  const { replica } = await openDevice(createFakeCell(), "tab");
  const { library } = fakePageLibrary({ answer: () => ({}) });
  const router = createAppRouter(createMemoryHistory({ initialEntries: ["/library"] }), {
    library: { ...library, replica },
    queryClient: createPageQueryClient(),
  });
  render(<RouterProvider router={router} />);
  fireEvent.click(await screen.findByRole("button", { name: "Add to the library" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Save a link…" }));
  await screen.findByRole("textbox", { name: ADDRESS });
  return replica;
};

const submit = (address: string): void => {
  fireEvent.change(screen.getByRole("textbox", { name: ADDRESS }), {
    target: { value: address },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
};

describe("Save a link", () => {
  it("keeps what was typed and says why when it is no web address", async () => {
    const replica = await askedToSaveALink();
    const saved = vi.spyOn(replica, "saveLink");

    submit("example.com");

    expect(screen.getByRole("textbox", { name: ADDRESS })).toHaveProperty("value", "example.com");
    expect(screen.getByRole("alert").textContent).toContain("https://");
    expect(saved).not.toHaveBeenCalled();
    await replica.close();
  });

  it("saves a web address and closes", async () => {
    const replica = await askedToSaveALink();
    const said = vi.spyOn(toast, "success");

    submit("https://example.com/page");

    await vi.waitFor(() => {
      expect(said.mock.lastCall?.[0]).toBe("Saved.");
    });
    expect(screen.queryByRole("textbox", { name: ADDRESS })).toBeNull();
    await replica.close();
  });

  it("says so when the save itself fails", async () => {
    const replica = await askedToSaveALink();
    const failed = vi.spyOn(toast, "error");
    vi.spyOn(replica, "saveLink").mockRejectedValue(new Error("the replica's file is gone"));

    submit("https://example.com/page");

    await vi.waitFor(() => {
      expect(failed).toHaveBeenCalledWith("That link couldn't be saved.");
    });
    await replica.close();
  });
});
