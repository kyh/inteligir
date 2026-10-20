// @vitest-environment jsdom

import type { ImportsPlanResponse } from "@repo/contract/local/imports/imports-schema";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ImportDialog, importSummary } from "./import-dialog";

afterEach(cleanup);

const MB = 1024 * 1024;

const plan = (fields: Partial<ImportsPlanResponse> = {}): ImportsPlanResponse => ({
  alreadySaved: 96,
  droppedTags: [],
  duplicates: 0,
  estimatedBytes: 8512 * 64 * 1024,
  folderCount: 34,
  folders: [],
  highlights: 1240,
  items: 8512,
  planId: "plan-1",
  skipped: [],
  skippedCount: 0,
  tags: 210,
  ...fields,
});

describe("what an import says before it starts", () => {
  it("counts what it adds and what it keeps, and that the pages fill in after", () => {
    expect(importSummary(plan({ estimatedBytes: 100 * MB }), true)).toEqual([
      "8,512 links in 34 folders, with 210 tags and 1,240 highlights.",
      "96 are already in your library and stay as they are.",
      "Each page's text and picture fill in over the next while.",
    ]);
  });

  it("says how much a synced library grows past 300 MB, in MB", () => {
    const lines = importSummary(plan({ estimatedBytes: 540 * MB }), true);
    expect(lines.at(-1)).toBe(
      "Their pages and pictures add about 540 MB. Your online library holds about 1 GB; once it is full, new saves stay on this Mac.",
    );
  });

  it("says nothing of an online library to a Mac that does not sync", () => {
    const lines = importSummary(plan({ estimatedBytes: 540 * MB }), false);
    expect(lines.join(" ")).not.toContain("online library");
  });

  it("names the rows it leaves out and the tags it cannot use", () => {
    const lines = importSummary(
      plan({
        alreadySaved: 0,
        droppedTags: ["?!"],
        folderCount: 0,
        highlights: 0,
        items: 1,
        skippedCount: 2,
        tags: 0,
      }),
      false,
    );
    expect(lines).toEqual([
      "1 link.",
      "2 rows are left out: no web address, or in Raindrop's trash.",
      "These tags can't be used here and are left off: ?!.",
      "Each page's text and picture fill in over the next while.",
    ]);
  });

  it("offers no Import when everything is already saved", () => {
    const onStart = vi.fn<(chosen: ImportsPlanResponse) => void>();
    render(
      <ImportDialog
        plan={plan({ alreadySaved: 12, items: 0 })}
        syncsOnline={false}
        starting={false}
        onStart={onStart}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("Everything in this backup is already in your library.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Import" })).toHaveProperty("disabled", true);
  });

  it("starts the plan it shows", () => {
    const onStart = vi.fn<(chosen: ImportsPlanResponse) => void>();
    const shown = plan();
    render(
      <ImportDialog
        plan={shown}
        syncsOnline={false}
        starting={false}
        onStart={onStart}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(onStart).toHaveBeenCalledWith(shown);
  });
});
