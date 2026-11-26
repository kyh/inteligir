import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DesktopUpdateState } from "./shell/desktop-bridge";
import { underShell as standIn } from "./test-support/desktop-shell.test-utils";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

let push: ReturnType<typeof standIn>["push"] = () => {};

const underShell = (answers: ReadonlyMap<string, DesktopUpdateState>) => {
  const shell = standIn((command) => answers.get(command) ?? null);

  ({ push } = shell);

  return shell.asked;
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
    push("update-state", state);
  });
};

describe("the Mac app's update", () => {
  it("is offered once the page's check finds one, and downloads only on a click", async () => {
    const asked = underShell(
      new Map<string, DesktopUpdateState>([
        ["check-for-updates", { status: "available", version: "1.2.3" }],
        ["download-update", { downloadPercent: 0, status: "downloading" }],
      ]),
    );

    await shown();
    const offered = await banner();
    expect(within(offered).getByText("Update available")).toBeDefined();
    expect(within(offered).getByText("Inteligir 1.2.3 is ready to download.")).toBeDefined();
    expect(asked).toStrictEqual(["check-for-updates"]);

    fireEvent.click(within(offered).getByRole("button", { name: "Download" }));
    await within(offered).findByText("Downloading the update");
    expect(asked).toStrictEqual(["check-for-updates", "download-update"]);
  });

  it("draws the download's progress the shell pushes", async () => {
    underShell(
      new Map<string, DesktopUpdateState>([
        ["check-for-updates", { downloadPercent: 0, status: "downloading" }],
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
        ["check-for-updates", { status: "downloaded", version: "1.2.3" }],
        ["install-update", { status: "downloaded", version: "1.2.3" }],
      ]),
    );

    await shown();
    const ready = await banner();
    expect(within(ready).getByText("Restart to finish installing Inteligir 1.2.3.")).toBeDefined();
    expect(asked).toStrictEqual(["check-for-updates"]);

    fireEvent.click(within(ready).getByRole("button", { name: "Restart" }));
    await vi.waitFor(() => {
      expect(asked).toStrictEqual(["check-for-updates", "install-update"]);
    });
  });

  it("says why a download didn't go through, and downloads again on Try again until it does", async () => {
    const answers = new Map<string, DesktopUpdateState>([
      ["check-for-updates", { status: "available", version: "1.2.3" }],
      [
        "download-update",
        { message: "The connection dropped.", status: "download-failed", version: "1.2.3" },
      ],
    ]);

    const asked = underShell(answers);
    await shown();
    const update = await banner();
    fireEvent.click(within(update).getByRole("button", { name: "Download" }));
    expect(await within(update).findByText("The download didn't go through")).toBeDefined();
    expect(within(update).getByText("The connection dropped.")).toBeDefined();
    expect(screen.getByText("Inteligir 1.2.3 didn't download.")).toBeDefined();

    answers.set("download-update", {
      message: "The feed is offline.",
      status: "download-failed",
      version: "1.2.3",
    });
    fireEvent.click(within(update).getByRole("button", { name: "Try again" }));
    expect(await within(update).findByText("The feed is offline.")).toBeDefined();
    expect(within(update).getByText("The download didn't go through")).toBeDefined();
    expect(asked).toStrictEqual(["check-for-updates", "download-update", "download-update"]);

    answers.set("download-update", { downloadPercent: 0, status: "downloading" });
    fireEvent.click(within(update).getByRole("button", { name: "Try again" }));
    expect(await within(update).findByText("Downloading the update")).toBeDefined();
    expect(asked).toStrictEqual([
      "check-for-updates",
      "download-update",
      "download-update",
      "download-update",
    ]);
  });

  it("says why an update didn't install, and restarts again on Try again", async () => {
    const asked = underShell(
      new Map<string, DesktopUpdateState>([
        [
          "check-for-updates",
          { message: "The disk is full.", status: "install-failed", version: "1.2.3" },
        ],
        ["install-update", { status: "downloaded", version: "1.2.3" }],
      ]),
    );

    await shown();
    const update = await banner();
    expect(within(update).getByText("The update didn't install")).toBeDefined();
    expect(within(update).getByText("The disk is full.")).toBeDefined();
    expect(screen.getByText("Inteligir 1.2.3 didn't install.")).toBeDefined();

    fireEvent.click(within(update).getByRole("button", { name: "Try again" }));
    expect(await within(update).findByText("Update ready")).toBeDefined();
    expect(asked).toStrictEqual(["check-for-updates", "install-update"]);
  });

  it("says a check that failed in Settings alone", async () => {
    underShell(
      new Map<string, DesktopUpdateState>([
        ["check-for-updates", { status: "available", version: "1.2.3" }],
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
        ["check-for-updates", { status: "available", version: "1.2.3" }],
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
