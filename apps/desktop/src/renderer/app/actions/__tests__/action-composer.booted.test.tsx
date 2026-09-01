// A refused first send costs the user NOTHING: the prompt stays in the field,
// the composer stays open, and the retry lands in the thread the first
// attempt created — never a second, empty one. The suite drives the REAL
// thread stack: the renderer's own client is answered by a booted in-process
// app, and the refusal is the provider's own dispatch failure.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkspaceProvider } from "../../workspace-context";
import { ActionComposer } from "../action-composer";
import { routeRendererFetch } from "./booted-fetch";
import { bootThreadHarness } from "./thread-harness";

/** The provider's invalidation socket, inert: nothing under test rides it. */
class InertSocket {
  addEventListener(): void {}
  send(): void {}
  close(): void {}
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the composer under a refused first send", () => {
  it("keeps the prompt and retries into the already-created thread", async () => {
    const harness = await bootThreadHarness({ mode: "manual" });
    vi.stubGlobal("WebSocket", InertSocket);
    routeRendererFetch(harness);
    harness.driver.failNextStart = new Error("the provider fell over");

    const onOpenChange = vi.fn();
    const onLaunched = vi.fn();
    render(
      <WorkspaceProvider>
        <ActionComposer
          open
          onOpenChange={onOpenChange}
          seed={null}
          docPath={null}
          readViewContext={() => Promise.resolve(null)}
          onLaunched={onLaunched}
        />
      </WorkspaceProvider>,
    );

    const field = screen.getByLabelText("Ask the agent");
    fireEvent.change(field, { target: { value: "Tidy the intro" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    // The refusal settles: the thread exists, and the composer gave up nothing.
    await waitFor(async () => {
      expect((await harness.client.threads.list()).threads).toHaveLength(1);
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Send" })).toHaveProperty("disabled", false);
    });
    expect(screen.getByLabelText("Ask the agent")).toHaveProperty("value", "Tidy the intro");
    expect(onLaunched).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(onLaunched).toHaveBeenCalledTimes(1);
    });

    const { threads } = await harness.client.threads.list();
    expect(threads).toHaveLength(1);
    expect(onLaunched).toHaveBeenCalledWith(threads[0]?.id);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(harness.driver.startedTurns.map((turn) => turn.threadId)).toEqual([threads[0]?.id]);
  });
});
