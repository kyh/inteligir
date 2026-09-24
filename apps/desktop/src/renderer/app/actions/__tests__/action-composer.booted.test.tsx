import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InertSocket } from "../../__tests__/inert-socket";
import { WorkspaceProvider } from "../../workspace-context";
import { ActionComposer } from "../action-composer";
import { routeRendererFetch } from "./booted-fetch";
import { bootThreadHarness } from "inteligir/server/testing";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const noViewContext = async () => null;

const noteColumn = { current: document.body };

describe("the composer under a refused first send", () => {
  it("keeps the prompt and retries into the already-created thread", async () => {
    const harness = await bootThreadHarness({ mode: "manual" });
    vi.stubGlobal("WebSocket", InertSocket);
    routeRendererFetch(harness);
    harness.driver.failNextStart = new Error("the provider fell over");

    const onOpenChange = vi.fn<(open: boolean) => void>();
    const onLaunched = vi.fn<(threadId: string) => void>();
    render(
      <WorkspaceProvider>
        <ActionComposer
          open
          onOpenChange={onOpenChange}
          seed={null}
          docPath={null}
          readViewContext={noViewContext}
          onLaunched={onLaunched}
          container={noteColumn}
        />
      </WorkspaceProvider>,
    );

    const field = screen.getByLabelText("Ask the agent");
    fireEvent.change(field, { target: { value: "Tidy the intro" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(async () => {
      const listed = await harness.client.threads.list({});
      expect(listed.threads).toHaveLength(1);
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

    const { threads } = await harness.client.threads.list({});
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

    const onLaunched = vi.fn<(threadId: string) => void>();
    const composerOver = (docPath: string, open = true) => (
      <WorkspaceProvider>
        <ActionComposer
          open={open}
          onOpenChange={() => {}}
          seed={null}
          docPath={docPath}
          readViewContext={noViewContext}
          onLaunched={onLaunched}
          container={noteColumn}
        />
      </WorkspaceProvider>
    );
    const view = render(composerOver("a.md"));
    fireEvent.change(screen.getByLabelText("Ask the agent"), {
      target: { value: "Tidy the intro" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(async () => {
      const listed = await harness.client.threads.list({});
      expect(listed.threads).toHaveLength(1);
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Send" })).toHaveProperty("disabled", false);
    });

    view.rerender(composerOver("a.md", false));
    view.rerender(composerOver("b.md"));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(onLaunched).toHaveBeenCalledTimes(1);
    });

    const { threads } = await harness.client.threads.list({});
    expect(threads).toHaveLength(2);
    const started = harness.driver.startedTurns.map((turn) => turn.threadId);
    expect(started).toHaveLength(1);
    expect(threads.find((thread) => thread.id === started[0])?.originDocPath).toBe("b.md");
  });
});

describe("the composer's @-mentions", () => {
  it("ride the send beside the typed text, never inside it", async () => {
    const harness = await bootThreadHarness({ mode: "manual" });
    vi.stubGlobal("WebSocket", InertSocket);
    routeRendererFetch(harness);
    await harness.client.vault.write({
      content: "# Plans\n",
      guard: { kind: "overwrite" },
      path: "Plans.md",
    });

    render(
      <WorkspaceProvider>
        <ActionComposer
          open
          onOpenChange={() => {}}
          seed={null}
          docPath={null}
          readViewContext={noViewContext}
          onLaunched={() => {}}
          container={noteColumn}
        />
      </WorkspaceProvider>,
    );

    const field = screen.getByRole("combobox", { name: "Ask the agent" });
    expect(field.getAttribute("aria-expanded")).toBe("false");
    fireEvent.change(field, { target: { value: "@Pla" } });
    const option = await screen.findByRole("option", { name: /Plans/u });
    const list = screen.getByRole("listbox", { name: "Mention a note" });
    expect(field.getAttribute("aria-expanded")).toBe("true");
    expect(field.getAttribute("aria-controls")).toBe(list.id);
    expect(field.getAttribute("aria-activedescendant")).toBe(option.id);
    expect(option.tabIndex).toBe(-1);

    fireEvent.mouseDown(option);
    fireEvent.change(field, { target: { value: "compare with the goals" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(harness.driver.startedTurns).toHaveLength(1);
    });
    expect(harness.driver.startedTurns[0]?.text).toBe("compare with the goals");
    expect(harness.driver.startedTurns[0]?.contextPaths).toEqual(["Plans.md"]);
    const { threads } = await harness.client.threads.list({});
    const [thread] = threads;
    expect(thread?.title).toBe("compare with the goals");
    const timeline = await harness.client.threads.timeline({ threadId: thread?.id ?? "" });
    const stored = timeline.kind === "full" ? timeline.timeline.rows[0] : undefined;
    expect(stored?.kind === "conversation" && stored.text).toBe("compare with the goals");
    expect(stored?.kind === "conversation" && stored.contextPaths).toEqual(["Plans.md"]);
  });
});
