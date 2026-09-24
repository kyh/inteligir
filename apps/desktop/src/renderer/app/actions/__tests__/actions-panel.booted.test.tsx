import { setTimeout as delay } from "node:timers/promises";
import { THREADS_LIST_DEFAULT_LIMIT } from "@repo/api/local/threads/threads-schema";
import type { CreateThreadRequest } from "@repo/api/local/threads/threads-schema";
import { threadScope, turnScope } from "@repo/domain/thread-event-scope";
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

const mountPanel = ({
  docPath,
  threadId,
}: {
  docPath: string | null;
  threadId: string | null;
}): void => {
  render(
    <WorkspaceProvider>
      <ActionsPanel
        docPath={docPath}
        tab="actions"
        onTabChange={noop}
        commentFocus={null}
        selectedThreadId={threadId}
        onSelectThread={noop}
        onOpenDoc={noop}
        noteMetadata={{ deleteNote: noop, openDeletedNotes: noop, setPinned: noop }}
        modifier="meta"
      />
    </WorkspaceProvider>,
  );
};

const mountAction = (threadId: string): void => {
  mountPanel({ docPath: null, threadId });
};

// `oldest` lands a millisecond before the rest, so no tie can sort it into their page.
const bootActions = async (count: number, oldest?: CreateThreadRequest): Promise<ThreadHarness> => {
  const harness = await bootThreadHarness({ mode: "manual" });
  vi.stubGlobal("WebSocket", InertSocket);
  routeRendererFetch(harness);
  if (oldest !== undefined) {
    await harness.client.threads.create(oldest);
    await delay(2);
  }
  for (let index = 0; index < count; index += 1) {
    await harness.client.threads.create({ title: `Action ${String(index)}` });
  }
  return harness;
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

  it("is not offered on a turn another device runs, which says so instead", async () => {
    const harness = await bootThreadHarness({ mode: "manual" });
    vi.stubGlobal("WebSocket", InertSocket);
    routeRendererFetch(harness);
    const threadId = "thr_remote";
    harness.composed.context.threads.applySyncedEvents({
      cursor: 1,
      rows: [
        {
          event: { scope: threadScope(), threadId, title: "Elsewhere", type: "thread/meta" },
          origin: { deviceId: "dev_other", deviceSeq: 1 },
        },
        {
          event: { scope: turnScope("turn_remote"), threadId, type: "turn/started" },
          origin: { deviceId: "dev_other", deviceSeq: 2 },
        },
      ],
      threadId,
    });
    mountAction(threadId);

    expect(await screen.findByText("Running on another device")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Stop action" })).toBeNull();
    expect(harness.driver.interruptedThreads).toEqual([]);
  });
});

describe("the action list", () => {
  const ROW = /^Action \d+$/u;

  it("shows a page of actions, and Show more reads the next", async () => {
    await bootActions(THREADS_LIST_DEFAULT_LIMIT + 1);
    mountPanel({ docPath: null, threadId: null });

    await waitFor(() => {
      expect(screen.getAllByText(ROW)).toHaveLength(THREADS_LIST_DEFAULT_LIMIT);
    });
    fireEvent.click(screen.getByRole("button", { name: "Show more recent actions" }));

    await waitFor(() => {
      expect(screen.getAllByText(ROW)).toHaveLength(THREADS_LIST_DEFAULT_LIMIT + 1);
    });
    expect(screen.queryByRole("button", { name: "Show more recent actions" })).toBeNull();
  });

  it("lists the open note's action though a page of newer ones came after it", async () => {
    await bootActions(THREADS_LIST_DEFAULT_LIMIT, {
      originDocPath: "notes/a.md",
      title: "The old one",
    });
    mountPanel({ docPath: "notes/a.md", threadId: null });

    expect(await screen.findByText("The old one")).toBeDefined();
    expect(screen.getByText("This note")).toBeDefined();
  });

  it("leaves an archived action out", async () => {
    const harness = await bootActions(1, { title: "Archived action" });
    const { threads } = await harness.client.threads.list({});
    const archived = threads.find((thread) => thread.title === "Archived action");
    if (archived === undefined) {
      throw new Error("expected the action to archive");
    }
    await harness.client.threads.archive({ threadId: archived.id });
    mountPanel({ docPath: null, threadId: null });

    expect(await screen.findByText("Action 0")).toBeDefined();
    expect(screen.queryByText("Archived action")).toBeNull();
  });
});
