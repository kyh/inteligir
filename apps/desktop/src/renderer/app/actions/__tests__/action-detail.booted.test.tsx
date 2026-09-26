import { readFile } from "node:fs/promises";
import path from "node:path";
import { createPendingInteraction } from "@repo/db/pending-interactions";
import { noopNotifier } from "@repo/domain/notifier";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  AGENT_COMMIT_AUTHOR,
  agentCommitMessage,
  bootThreadHarness,
} from "inteligir/server/testing";
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

const bootPanel = async (): Promise<ThreadHarness> => {
  const harness = await bootThreadHarness({ mode: "manual" });
  vi.stubGlobal("WebSocket", InertSocket);
  routeRendererFetch(harness);
  return harness;
};

const mountDetail = (threadId: string): void => {
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
        modifier="meta"
      />
    </WorkspaceProvider>,
  );
};

const allowOnce = (): HTMLElement => screen.getByRole("button", { name: "Allow once" });

describe("the action detail's transcript", () => {
  it("says the transcript could not be read, never an empty one", async () => {
    await bootPanel();

    mountDetail("thr_missing");
    expect(await screen.findByText("The transcript could not be read.")).toBeTruthy();
    expect(screen.getByText("Thread not found")).toBeTruthy();
  });

  it("shows a reply sent into a running turn as queued", async () => {
    const harness = await bootPanel();
    const { thread } = await harness.client.threads.create({});
    await harness.client.threads.send({ text: "first", threadId: thread.id });

    mountDetail(thread.id);
    // the server names the thread from its first message, so the header reads it as well
    await waitFor(() => {
      expect(screen.getAllByText("first")).toHaveLength(2);
    });
    const field = screen.getByLabelText("Reply to the agent");
    fireEvent.change(field, { target: { value: "for later" } });
    fireEvent.keyDown(field, { key: "Enter" });

    // the bubble first: until the send clears it, the field's own text also reads "for later"
    expect(await screen.findByText("Queued")).toBeTruthy();
    expect(field).toHaveProperty("value", "");
    expect(screen.getByText("for later")).toBeTruthy();
  });
});

describe("the action detail's changes footer", () => {
  it("offers a settled turn's changes back, and says so once the undo lands", async () => {
    const harness = await bootPanel();
    const { client } = harness;
    const plans = path.join(harness.vaultDir, "Plans.md");
    await client.vault.write({
      content: "# Plans\n",
      guard: { kind: "overwrite" },
      path: "Plans.md",
    });
    await client.vault.commitNow();
    const { thread } = await client.threads.create({});
    const sent = await client.threads.send({ text: "tidy the plan", threadId: thread.id });
    if (sent.kind !== "started") {
      throw new Error(`expected a started turn, got ${sent.kind}`);
    }
    harness.driver.completeTurn(thread.id, sent.turnId, "completed");
    // the turn's write and its commit, as the agent's turn writes land them
    await client.vault.write({
      content: "# Plans\n\nTidied.\n",
      guard: { kind: "overwrite" },
      path: "Plans.md",
    });
    await harness.vault.git.commitPaths(
      ["Plans.md"],
      AGENT_COMMIT_AUTHOR,
      agentCommitMessage(thread.id, sent.turnId),
    );

    mountDetail(thread.id);
    expect(await screen.findByText("Edited 1 note")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Undo changes" }));

    // no socket reaches this page, so the footer moves on the undo's own re-read
    expect(await screen.findByText("Changes undone")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Undo changes" })).toBeNull();
    expect(await readFile(plans, "utf-8")).toBe("# Plans\n");
  });
});

describe("the action detail's approval card", () => {
  it("keeps its options clickable after the answer route refuses, and the retry lands", async () => {
    const harness = await bootPanel();
    const { thread } = await harness.client.threads.create({});
    createPendingInteraction(harness.db, noopNotifier, {
      payload: JSON.stringify({
        availableDecisions: ["allow_once"],
        kind: "approval",
        reason: null,
        subject: { command: "rm -rf dist", cwd: null, itemId: "item_1", kind: "command" },
      }),
      requestKey: "req-card",
      threadId: thread.id,
    });
    let refuseNextAnswer = true;
    // the signal is dropped for the reason booted-fetch gives
    vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (refuseNextAnswer && url.includes("answerInteraction")) {
        refuseNextAnswer = false;
        return new Response("the server stepped away", { status: 503 });
      }
      return await harness.request(url, { ...init, signal: null });
    });

    mountDetail(thread.id);
    fireEvent.click(await screen.findByRole("button", { name: "Allow once" }));
    await waitFor(() => {
      expect(refuseNextAnswer).toBe(false);
      expect(allowOnce()).toHaveProperty("disabled", false);
    });
    expect(screen.queryByText("Answer sent")).toBeNull();

    fireEvent.click(allowOnce());
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Allow once" })).toBeNull();
    });
    const detail = await harness.client.threads.get({ threadId: thread.id });
    expect(detail.pendingInteractions).toEqual([]);
  });
});
