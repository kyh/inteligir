// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import path from "node:path";
import { threadStatusValues } from "@repo/domain/thread-status";
import type { Thread } from "@repo/api/local/threads/threads-schema";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultRequest,
  emptySearchSource,
  makeActions,
  renderWithQueries,
  stubKnowledgeFetch,
} from "../palette/__tests__/palette-harness";
import { THREAD_ACTIVITY_LABELS, threadActivity } from "../thread-activity";

afterEach(cleanup);

const thread = (over: Partial<Thread> = {}): Thread => ({
  activeTurnId: null,
  archivedAt: null,
  createdAt: 0,
  id: "thr_1",
  originDocPath: null,
  providerId: null,
  status: "idle",
  title: null,
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
    expect(threadActivity(thread({ archivedAt: 1, status: "active" }))).toBe("archived");
  });
});

describe("the palette renders that answer and no other", () => {
  it.each(threadStatusValues)("says what the derivation says for %s", (status) => {
    const subject = thread({ id: `thr_${status}`, status, title: "A thread" });
    stubKnowledgeFetch({});
    renderWithQueries({
      actions: makeActions(),
      canSync: false,
      entries: [],
      onOpenChange: vi.fn<() => void>(),
      open: true,
      request: defaultRequest,
      searchSource: emptySearchSource,
      threads: [subject],
    });
    fireEvent.click(screen.getByText("Actions"));
    expect(screen.getByText(THREAD_ACTIVITY_LABELS[threadActivity(subject)])).toBeDefined();
  });
});

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../../../..");
const sourceOf = (relative: string): string =>
  readFileSync(path.join(REPO_ROOT, relative), "utf-8");

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
