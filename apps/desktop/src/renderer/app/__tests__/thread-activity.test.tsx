// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import path from "node:path";
import { isThreadRunning, threadStatusValues } from "@repo/domain/thread-status";
import type { Thread } from "@repo/api/local/threads/threads-schema";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultRequest,
  makeActions,
  renderWithQueries,
  stubPaletteFetch,
} from "../palette/__tests__/palette-harness";
import { THREAD_ACTIVITY_LABELS, threadActivity, threadStopControl } from "../thread-activity";
import { rendererSources } from "./renderer-sources";

afterEach(cleanup);

const thread = (over: Partial<Thread> = {}): Thread => ({
  activeTurnId: null,
  archivedAt: null,
  createdAt: 0,
  id: "thr_1",
  originDocPath: null,
  providerId: null,
  runsElsewhere: false,
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

  it("archived beats the lifecycle, while the status alone still says the turn runs", () => {
    const archivedRunning = thread({ archivedAt: 1, status: "active" });
    expect(threadActivity(archivedRunning)).toBe("archived");
    expect(isThreadRunning(archivedRunning.status)).toBe(true);
  });
});

describe("threadStopControl", () => {
  it("offers a stop while a turn runs, holds it once requested, and offers none when settled", () => {
    const controls = threadStatusValues.map((status) => [
      status,
      threadStopControl(thread({ status })),
    ]);
    expect(Object.fromEntries(controls)).toEqual({
      active: "stop",
      error: "none",
      idle: "none",
      starting: "stop",
      stopping: "requested",
    });
  });

  it("still offers a stop on an archived thread whose turn runs", () => {
    expect(threadStopControl(thread({ archivedAt: 1, status: "active" }))).toBe("stop");
  });

  it("offers none on a turn another device runs", () => {
    expect(threadStopControl(thread({ runsElsewhere: true, status: "active" }))).toBe("none");
  });
});

describe("the palette renders that answer and no other", () => {
  it.each(threadStatusValues)("says what the derivation says for %s", (status) => {
    const subject = thread({ id: `thr_${status}`, status, title: "A thread" });
    stubPaletteFetch({});
    renderWithQueries({
      actions: makeActions(),
      canSync: false,
      entries: [],
      onOpenChange: vi.fn<() => void>(),
      open: true,
      request: defaultRequest,
      threads: [subject],
    });
    fireEvent.click(screen.getByText("Actions"));
    expect(screen.getByText(THREAD_ACTIVITY_LABELS[threadActivity(subject)])).toBeDefined();
  });
});

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../../../..");
const RENDERER = path.join(REPO_ROOT, "apps/desktop/src/renderer");
const THREAD_STATUS = path.join(REPO_ROOT, "packages/domain/src/thread-status.ts");

describe("no renderer module reads a thread's lifecycle", () => {
  const LIFECYCLE = /["'](?:starting|stopping)["']/u;

  it("every surface asks isThreadRunning or threadActivity", () => {
    const spelled = rendererSources(RENDERER)
      .filter((file) => LIFECYCLE.test(readFileSync(file, "utf-8")))
      .map((file) => path.relative(REPO_ROOT, file));
    expect(spelled, "a status spelled here drifts from @repo/domain/thread-status").toEqual([]);
  });

  it("names @repo/domain/thread-status as the one that does", () => {
    expect(readFileSync(THREAD_STATUS, "utf-8")).toMatch(LIFECYCLE);
  });
});
