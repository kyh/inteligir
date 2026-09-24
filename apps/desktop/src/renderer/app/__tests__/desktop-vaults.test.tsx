// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopVaultsBridge } from "../../../types";
import { openRecentVault, useVaultSwitch } from "../desktop-vaults";
import { inertBridge } from "./inert-bridge";

afterEach(() => {
  cleanup();
  delete window.desktopBridge;
  vi.restoreAllMocks();
});

const installOpen = (open: DesktopVaultsBridge["open"]): void => {
  const bridge = inertBridge();
  window.desktopBridge = { ...bridge, vaults: { ...bridge.vaults, open } };
};

const openThroughSwitch = async (): Promise<string[]> => {
  const refusals: string[] = [];
  const { result } = renderHook(() =>
    useVaultSwitch((message) => {
      refusals.push(message);
    }),
  );
  await act(async () => {
    result.current.run("opening", async () => await openRecentVault("/home/me/Work"));
  });
  expect(result.current.busy).toBeNull();
  return refusals;
};

describe("a vault switch's answer", () => {
  it("shows main's refusal in main's words", async () => {
    installOpen(async () => ({ ok: false, reason: "That vault is not one the app remembers." }));
    expect(await openThroughSwitch()).toEqual(["That vault is not one the app remembers."]);
  });

  it("shows nothing when nothing was refused", async () => {
    installOpen(inertBridge().vaults.open);
    expect(await openThroughSwitch()).toEqual([]);
  });

  it("words a fault itself rather than passing on Electron's wrapper", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    installOpen(async () => {
      throw new Error("Error invoking remote method 'desktop:vaults-open': Error: refused");
    });
    expect(await openThroughSwitch()).toEqual(["Could not open that vault."]);
  });
});
