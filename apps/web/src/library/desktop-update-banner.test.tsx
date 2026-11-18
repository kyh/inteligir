import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DesktopUpdateState } from "./shell/desktop-bridge";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  clearMocks();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const underShell = (answers: ReadonlyMap<string, DesktopUpdateState>) => {
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

const notices = () => screen.getByRole("region", { name: /^Notifications/u });

const banner = async () => await within(notices()).findByRole("listitem");

const pushed = async (state: DesktopUpdateState) => {
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

  it("says why a download didn't go through, and checks again on Try again", async () => {
    const asked = underShell(
      new Map<string, DesktopUpdateState>([
        ["check_for_updates", { status: "available", version: "1.2.3" }],
        ["download_update", { message: "The signature didn't match.", status: "error" }],
      ]),
    );

    await shown();
    const update = await banner();
    fireEvent.click(within(update).getByRole("button", { name: "Download" }));
    expect(await within(update).findByText("The update didn't go through")).toBeDefined();
    expect(within(update).getByText("The signature didn't match.")).toBeDefined();

    fireEvent.click(within(update).getByRole("button", { name: "Try again" }));
    await vi.waitFor(() => {
      expect(asked).toStrictEqual(["check_for_updates", "download_update", "check_for_updates"]);
    });
  });

  it("says a check that failed in Settings alone", async () => {
    underShell(
      new Map<string, DesktopUpdateState>([
        ["check_for_updates", { status: "available", version: "1.2.3" }],
      ]),
    );
    await shown();
    await banner();
    await vi.waitFor(async () => {
      await pushed({ message: "The feed didn't answer.", status: "check-failed" });
      expect(within(notices()).queryByRole("listitem")).toBeNull();
    });
    expect(screen.getByText("Inteligir couldn't check for updates.")).toBeDefined();
    expect(screen.getByText("The feed didn't answer.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Check for updates" })).toBeDefined();
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
