// @vitest-environment jsdom

import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DesktopUpdateState } from "../shell/desktop-bridge";

// the store reads its bridge as the module loads, so each test loads the page's modules afresh
beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  cleanup();
  clearMocks();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// the Mac app's shell, answering each update command as updater.rs does
const underShell = (answers: ReadonlyMap<string, DesktopUpdateState>): string[] => {
  const asked: string[] = [];
  vi.stubGlobal("isTauri", true);
  mockIPC(
    (command) => {
      asked.push(command);
      return answers.get(command) ?? null;
    },
    { shouldMockEvents: true },
  );
  return asked;
};

const shown = async () => {
  const [{ toast }, { UpdateNotice }, { UpdatesRow }] = await Promise.all([
    import("@repo/ui/components/sonner"),
    import("./update-notice"),
    import("./settings/updates-row"),
  ]);
  const info = vi.spyOn(toast, "info");
  render(
    <>
      <UpdateNotice />
      <UpdatesRow />
    </>,
  );
  return { info };
};

describe("the Mac app's update", () => {
  it("is offered once the page's check finds one, and downloads only on a click", async () => {
    const asked = underShell(
      new Map<string, DesktopUpdateState>([
        ["check_for_updates", { status: "available", version: "1.2.3" }],
        ["download_update", { downloadPercent: 0, status: "downloading" }],
      ]),
    );
    const { info } = await shown();
    await screen.findByText("Inteligir 1.2.3 is ready to download.");
    expect(info).toHaveBeenCalledWith(
      "Inteligir 1.2.3 is available.",
      expect.objectContaining({ action: expect.objectContaining({ label: "Download" }) }),
    );
    expect(asked).toStrictEqual(["check_for_updates"]);

    screen.getByRole("button", { name: "Download" }).click();
    await screen.findByText("Downloading the update — 0%");
    expect(asked).toStrictEqual(["check_for_updates", "download_update"]);
  });

  it("is not there in a browser tab, and Settings says where updates come from", async () => {
    const { info } = await shown();
    expect(screen.getByText("Updates come with the Mac app.")).toBeDefined();
    expect(info).not.toHaveBeenCalled();
  });
});
