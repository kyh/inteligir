import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { fakePageLibrary, renderOnLibrary } from "../test-support/fake-page-library";
import { Panel } from "./panel";

const MESSAGE = { name: "Message the agent" };

describe("the panel", () => {
  it("keeps a message typed to the agent through Info and back", async () => {
    const { library } = fakePageLibrary();
    library.workspace.showPanelTab("agent");
    renderOnLibrary(
      <Panel
        itemId={null}
        viewContext={() => {}}
        infoActions={{ move: vi.fn<() => void>(), tag: vi.fn<() => void>() }}
        flushOpen={vi.fn<() => Promise<void>>()}
      />,
      library,
    );

    fireEvent.change(screen.getByRole("textbox", MESSAGE), { target: { value: "Half a thought" } });
    fireEvent.click(screen.getByRole("tab", { name: "Info" }));
    await screen.findByText("Select an item to see it here.");
    expect(screen.queryByRole("textbox", MESSAGE)).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Agent" }));

    const field = await screen.findByRole("textbox", MESSAGE);
    expect(field).toHaveProperty("value", "Half a thought");
  });
});
