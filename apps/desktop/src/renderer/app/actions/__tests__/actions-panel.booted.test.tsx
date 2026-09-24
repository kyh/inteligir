import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { bootThreadHarness } from "inteligir/server/testing";
import type { ThreadHarness } from "inteligir/server/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InertSocket } from "../../__tests__/inert-socket";
import { WorkspaceProvider } from "../../workspace-context";
import { ActionsPanel } from "../actions-panel";
import { routeRendererFetch } from "./booted-fetch";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const noop = (): void => {};

const bootRunningAction = async (): Promise<{ harness: ThreadHarness; threadId: string }> => {
  const harness = await bootThreadHarness({ mode: "manual" });
  vi.stubGlobal("WebSocket", InertSocket);
  routeRendererFetch(harness);
  const { thread } = await harness.client.threads.create({ title: "Rewrite the intro" });
  await harness.client.threads.send({ text: "rewrite it", threadId: thread.id });
  return { harness, threadId: thread.id };
};

const mountAction = (threadId: string): void => {
  render(
    <WorkspaceProvider>
      <ActionsPanel
        docPath={null}
        tab="actions"
        onTabChange={noop}
        commentFocus={null}
        selectedThreadId={threadId}
        onSelectThread={noop}
        onOpenDoc={noop}
        noteMetadata={{ deleteNote: noop, openDeletedNotes: noop, setPinned: noop }}
      />
    </WorkspaceProvider>,
  );
};

describe("the Stop button on an action", () => {
  it("stops the running turn, and goes once the action settles", async () => {
    const { harness, threadId } = await bootRunningAction();
    mountAction(threadId);

    fireEvent.click(await screen.findByRole("button", { name: "Stop action" }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Stop action" })).toBeNull();
    });
    expect(harness.driver.interruptedThreads).toEqual([threadId]);
    const { thread } = await harness.client.threads.get({ threadId });
    expect(thread.status).toBe("idle");
  });

  it("holds, disabled, while the agent is still stopping", async () => {
    const { harness, threadId } = await bootRunningAction();
    harness.driver.settleOnInterrupt = false;
    mountAction(threadId);

    fireEvent.click(await screen.findByRole("button", { name: "Stop action" }));

    const stopping = await screen.findByRole("button", { name: "Stopping action" });
    expect(stopping).toHaveProperty("disabled", true);
  });

  it("is not offered on an action with nothing running", async () => {
    const { harness, threadId } = await bootRunningAction();
    const turn = harness.driver.startedTurns.at(0);
    if (turn === undefined) {
      throw new Error("expected the started turn");
    }
    harness.driver.completeTurn(threadId, turn.turnId, "completed");
    mountAction(threadId);

    await screen.findByText("Rewrite the intro");
    expect(screen.queryByRole("button", { name: "Stop action" })).toBeNull();
  });
});
