// A refused first send costs the user NOTHING: the prompt stays in the field,
// the composer stays open, and the retry lands in the thread the first
// attempt created — never a second, empty one — for as long as the retry is
// over the SAME note; a thread is attached at creation, so a retry from
// another note mints its own. The suite drives the REAL thread stack: the
// renderer's own client is answered by a booted in-process app, and the
// refusal is the provider's own dispatch failure.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InertSocket } from "../../__tests__/inert-socket";
import { WorkspaceProvider } from "../../workspace-context";
import { ActionComposer } from "../action-composer";
import { routeRendererFetch } from "./booted-fetch";
import { bootThreadHarness } from "./thread-harness";

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

  it("mints a fresh thread when the retry is over another note", async () => {
    const harness = await bootThreadHarness({ mode: "manual" });
    vi.stubGlobal("WebSocket", InertSocket);
    routeRendererFetch(harness);
    harness.driver.failNextStart = new Error("the provider fell over");

    const onLaunched = vi.fn();
    const composerOver = (docPath: string, open = true) => (
      <WorkspaceProvider>
        <ActionComposer
          open={open}
          onOpenChange={() => {}}
          seed={null}
          docPath={docPath}
          readViewContext={() => Promise.resolve(null)}
          onLaunched={onLaunched}
        />
      </WorkspaceProvider>
    );
    const view = render(composerOver("a.md"));
    fireEvent.change(screen.getByLabelText("Ask the agent"), {
      target: { value: "Tidy the intro" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(async () => {
      expect((await harness.client.threads.list()).threads).toHaveLength(1);
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Send" })).toHaveProperty("disabled", false);
    });

    // Escape, then ⌘K over another note: the composer stays mounted through
    // the close, so the draft — and the refused thread — survive it.
    view.rerender(composerOver("a.md", false));
    view.rerender(composerOver("b.md"));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(onLaunched).toHaveBeenCalledTimes(1);
    });

    const { threads } = await harness.client.threads.list();
    expect(threads).toHaveLength(2);
    const started = harness.driver.startedTurns.map((turn) => turn.threadId);
    expect(started).toHaveLength(1);
    expect(threads.find((thread) => thread.id === started[0])?.originDocPath).toBe("b.md");
  });
});
