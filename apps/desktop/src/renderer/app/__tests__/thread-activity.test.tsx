// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { threadStatusValues } from "@repo/domain/thread-status";
import type { Thread } from "@repo/api/local/threads/threads-schema";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "../palette/command-palette";
import { THREAD_ACTIVITY_LABELS, threadActivity } from "../thread-activity";

afterEach(cleanup);

const thread = (over: Partial<Thread> = {}): Thread => ({
  id: "thr_1",
  title: null,
  status: "idle",
  activeTurnId: null,
  originDocPath: null,
  providerId: null,
  archivedAt: null,
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

describe("threadActivity", () => {
  it("collapses the three in-flight statuses into one answer", () => {
    for (const status of ["starting", "active", "stopping"] as const) {
      expect(threadActivity(thread({ status }))).toBe("running");
    }
    expect(threadActivity(thread({ status: "error" }))).toBe("failed");
    expect(threadActivity(thread({ status: "idle" }))).toBe("done");
  });

  it("archived beats the lifecycle", () => {
    expect(threadActivity(thread({ status: "active", archivedAt: 1 }))).toBe("archived");
  });
});

describe("the palette renders that answer and no other", () => {
  it.each(threadStatusValues)("says what the derivation says for %s", (status) => {
    const subject = thread({ id: `thr_${status}`, status, title: "A thread" });
    render(
      <CommandPalette
        open
        onOpenChange={vi.fn()}
        entries={[]}
        threads={[subject]}
        searchSource={() => Promise.resolve([])}
        matchSource={() => Promise.resolve({ matches: [], total: 0 })}
        canSync={false}
        actions={{
          openNote: vi.fn(),
          newNote: vi.fn(),
          newNoteFromTemplate: vi.fn(),
          openDailyNote: vi.fn(),
          openThread: vi.fn(),
          syncNow: vi.fn(),
          openSettings: vi.fn(),
          openDeletedNotes: vi.fn(),
          findInNote: null,
          insertTemplate: null,
          exportPdf: null,
          moveNote: vi.fn(),
          pinNote: null,
          unpinNote: null,
          openMatch: vi.fn(),
          replaceAll: vi.fn(),
          listHeadings: null,
          goToHeading: vi.fn(),
        }}
      />,
    );
    fireEvent.click(screen.getByText("Actions"));
    expect(screen.getByText(THREAD_ACTIVITY_LABELS[threadActivity(subject)])).toBeDefined();
  });
});

const REPO_ROOT = resolve(import.meta.dirname, "../../../../../..");
const sourceOf = (relative: string): string => readFileSync(join(REPO_ROOT, relative), "utf8");

describe("only one module reads a thread's lifecycle", () => {
  const LIFECYCLE = /["'](?:starting|stopping)["']/u;

  it.each([
    "apps/desktop/src/renderer/app/actions/actions-panel.tsx",
    "apps/desktop/src/renderer/app/actions/action-composer.tsx",
    "apps/desktop/src/renderer/app/palette/command-palette.tsx",
  ])("%s derives none of its own", (relative) => {
    expect(sourceOf(relative)).not.toMatch(LIFECYCLE);
  });

  it("names thread-activity.ts as the one that does", () => {
    expect(sourceOf("apps/desktop/src/renderer/app/thread-activity.ts")).toMatch(LIFECYCLE);
  });
});
