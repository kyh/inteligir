// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { threadStatusValues } from "@repo/domain/thread-status";
import type { Thread } from "@repo/server-contract/threads";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "../../palette/command-palette";
import { NO_ACTIVITY_COUNTS, THREAD_ACTIVITY_LABELS, threadActivity } from "../chat-model";

afterEach(cleanup);

const thread = (over: Partial<Thread> = {}): Thread => ({
  id: "thr_1",
  title: null,
  status: "idle",
  activeTurnId: null,
  originDocPath: null,
  originAnchor: null,
  writeMode: "direct",
  archivedAt: null,
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

describe("threadActivity", () => {
  it("collapses the three in-flight statuses into one answer", () => {
    for (const status of ["starting", "active", "stopping"] as const) {
      expect(threadActivity(thread({ status }), NO_ACTIVITY_COUNTS)).toBe("running");
    }
    expect(threadActivity(thread({ status: "error" }), NO_ACTIVITY_COUNTS)).toBe("failed");
    expect(threadActivity(thread({ status: "idle" }), NO_ACTIVITY_COUNTS)).toBe("done");
  });

  it("reads the counts a Thread cannot carry, and archived beats them all", () => {
    const idle = thread({ status: "idle" });
    expect(threadActivity(idle, { ...NO_ACTIVITY_COUNTS, queuedCount: 2 })).toBe("queued");
    expect(
      threadActivity(idle, { ...NO_ACTIVITY_COUNTS, openInteractionCount: 1, queuedCount: 2 }),
    ).toBe("needs-approval");
    expect(
      threadActivity(thread({ status: "active", archivedAt: 1 }), {
        openInteractionCount: 1,
        queuedCount: 1,
        pendingProposalCount: 1,
      }),
    ).toBe("archived");
  });

  it("ranks a pending suggestion above done and below everything blocking", () => {
    const idle = thread({ status: "idle" });
    expect(threadActivity(idle, { ...NO_ACTIVITY_COUNTS, pendingProposalCount: 1 })).toBe(
      "needs-review",
    );
    // A queue and an approval both block the AGENT; a suggestion waits on the
    // user with the turn already over, so it never masks either.
    expect(
      threadActivity(idle, { ...NO_ACTIVITY_COUNTS, queuedCount: 1, pendingProposalCount: 1 }),
    ).toBe("queued");
    expect(
      threadActivity(idle, {
        ...NO_ACTIVITY_COUNTS,
        openInteractionCount: 1,
        pendingProposalCount: 1,
      }),
    ).toBe("needs-approval");
    // A running turn is still running, whatever an earlier one left behind.
    expect(
      threadActivity(thread({ status: "active" }), {
        ...NO_ACTIVITY_COUNTS,
        pendingProposalCount: 1,
      }),
    ).toBe("running");
  });
});

describe("the palette renders that answer and no other", () => {
  // Pre-dedup the palette carried its own status table and said "idle" where
  // the doc chip said "done" for the very same thread.
  it.each(threadStatusValues)("says what the derivation says for %s", (status) => {
    const subject = thread({ id: `thr_${status}`, status, title: "A thread" });
    render(
      <CommandPalette
        open
        onOpenChange={vi.fn()}
        entries={[]}
        threads={[subject]}
        searchSource={() => Promise.resolve([])}
        canSync={false}
        actions={{
          openNote: vi.fn(),
          newNote: vi.fn(),
          openDailyNote: vi.fn(),
          openThread: vi.fn(),
          syncNow: vi.fn(),
          openSettings: vi.fn(),
        }}
      />,
    );
    fireEvent.click(screen.getByText("Chats & delegations"));
    expect(
      screen.getByText(THREAD_ACTIVITY_LABELS[threadActivity(subject, NO_ACTIVITY_COUNTS)]),
    ).toBeDefined();
  });
});

const REPO_ROOT = resolve(import.meta.dirname, "../../../../../..");
const sourceOf = (relative: string): string => readFileSync(join(REPO_ROOT, relative), "utf8");

describe("only one module reads a thread's lifecycle", () => {
  // The lifecycle literals are the fingerprint of a surface deriving activity
  // for itself. A fourth vocabulary is how the same thread came to read
  // "running" in the palette while the dock painted it amber — and the editor
  // must not carry one at all, being a package with no domain to have it in.
  const LIFECYCLE = /["'](?:starting|stopping)["']/u;

  it.each([
    "apps/app/src/app/chat/chat-dock.tsx",
    "apps/app/src/app/palette/command-palette.tsx",
    "apps/app/src/app/note/note-view.tsx",
    "packages/editor/src/thread-chip.ts",
  ])("%s derives none of its own", (relative) => {
    expect(sourceOf(relative)).not.toMatch(LIFECYCLE);
  });

  it("names chat-model.ts as the one that does", () => {
    expect(sourceOf("apps/app/src/app/chat/chat-model.ts")).toMatch(LIFECYCLE);
  });
});
