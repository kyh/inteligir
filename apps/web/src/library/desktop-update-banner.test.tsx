// @vitest-environment jsdom

import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DesktopUpdateState } from "./shell/desktop-bridge";

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

const shown = async (): Promise<void> => {
  const [{ DesktopUpdateBanner }, { UpdatesRow }, { Toaster }, { ThemeProvider }] =
    await Promise.all([
      import("./desktop-update-banner"),
      import("./settings/updates-row"),
      import("@repo/ui/components/sonner"),
      import("#components/theme-provider"),
    ]);
  render(
    <ThemeProvider>
      <Toaster />
      <DesktopUpdateBanner />
      <UpdatesRow />
    </ThemeProvider>,
  );
};

// the toaster's live region, which announces what lands in it
const notices = (): HTMLElement => screen.getByRole("region", { name: /^Notifications/u });

const banner = async (): Promise<HTMLElement> => await within(notices()).findByRole("listitem");

// the shell's push; the page's listener registers a tick after it subscribes, so a case retries it
const pushed = async (state: DesktopUpdateState): Promise<void> => {
  await act(async () => {
    await emit("update-state", state);
  });
};

describe("the Mac app's update", () => {
  it("is offered once the page's check finds one, and downloads only on a click", async () => {
    const asked = underShell(
      new Map<string, DesktopUpdateState>([
        ["check_for_updates", { status: "available", version: "1.2.3" }],
        ["download_update", { downloadPercent: 0, status: "downloading" }],
      ]),
    );
    await shown();
    const offered = await banner();
    expect(within(offered).getByText("Update available")).toBeDefined();
    expect(within(offered).getByText("Inteligir 1.2.3 is ready to download.")).toBeDefined();
    expect(asked).toStrictEqual(["check_for_updates"]);

    fireEvent.click(within(offered).getByRole("button", { name: "Download" }));
    await within(offered).findByText("Downloading the update");
    expect(asked).toStrictEqual(["check_for_updates", "download_update"]);
  });

  it("draws the download's progress the shell pushes", async () => {
    underShell(
      new Map<string, DesktopUpdateState>([
        ["check_for_updates", { downloadPercent: 0, status: "downloading" }],
      ]),
    );
    await shown();
    const downloading = await banner();
    const progress = within(downloading).getByRole("progressbar", { name: "Download progress" });
    expect(progress.getAttribute("aria-valuenow")).toBe("0");

    await vi.waitFor(async () => {
      await pushed({ downloadPercent: 40, status: "downloading" });
      expect(within(downloading).getByText("40% complete")).toBeDefined();
    });
    expect(progress.getAttribute("aria-valuenow")).toBe("40");
    expect(within(downloading).queryByRole("button")).toBeNull();
  });

  it("restarts only on a click once the download is in", async () => {
    const asked = underShell(
      new Map<string, DesktopUpdateState>([
        ["check_for_updates", { status: "downloaded", version: "1.2.3" }],
        ["install_update", { status: "downloaded", version: "1.2.3" }],
      ]),
    );
    await shown();
    const ready = await banner();
    expect(within(ready).getByText("Restart to finish installing Inteligir 1.2.3.")).toBeDefined();
    expect(asked).toStrictEqual(["check_for_updates"]);

    fireEvent.click(within(ready).getByRole("button", { name: "Restart" }));
    await vi.waitFor(() => {
      expect(asked).toStrictEqual(["check_for_updates", "install_update"]);
    });
  });

  it("says why an update didn't go through, and checks again on Try again", async () => {
    const asked = underShell(
      new Map<string, DesktopUpdateState>([
        ["check_for_updates", { message: "The signature didn't match.", status: "error" }],
      ]),
    );
    await shown();
    const failed = await banner();
    expect(within(failed).getByText("The update didn't go through")).toBeDefined();
    expect(within(failed).getByText("The signature didn't match.")).toBeDefined();

    fireEvent.click(within(failed).getByRole("button", { name: "Try again" }));
    await vi.waitFor(() => {
      expect(asked).toStrictEqual(["check_for_updates", "check_for_updates"]);
    });
  });

  it("leaves once there is nothing to do about the update", async () => {
    underShell(
      new Map<string, DesktopUpdateState>([
        ["check_for_updates", { status: "available", version: "1.2.3" }],
      ]),
    );
    await shown();
    await banner();
    await vi.waitFor(async () => {
      await pushed({ status: "not-available" });
      expect(within(notices()).queryByRole("listitem")).toBeNull();
    });
    expect(screen.getByText("Inteligir is up to date.")).toBeDefined();
  });

  it("is not there in a browser tab, and Settings says where updates come from", async () => {
    await shown();
    expect(screen.getByText("Updates come with the Mac app.")).toBeDefined();
    expect(within(notices()).queryByRole("listitem")).toBeNull();
  });
});
