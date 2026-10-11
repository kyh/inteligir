// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_COMMANDS } from "../../../ipc-contract";
import type { VaultsState } from "../../../vaults-state";
import { clearShell, mockShell, reply } from "../../__tests__/mock-shell";
import { openRecentVault, useVaultSwitch } from "../desktop-vaults";

afterEach(() => {
  cleanup();
  clearShell();
  vi.restoreAllMocks();
});

const VAULTS: VaultsState = {
  blocked: null,
  current: { name: "Inteligir", path: "/home/me/Inteligir" },
  recent: [],
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
  it("shows the shell's refusal in its words", async () => {
    mockShell(
      reply(APP_COMMANDS.vaults.open)(() => ({
        ok: false,
        reason: "That vault is not one the app remembers.",
      })),
    );
    expect(await openThroughSwitch()).toEqual(["That vault is not one the app remembers."]);
  });

  it("shows nothing when nothing was refused", async () => {
    mockShell(reply(APP_COMMANDS.vaults.open)(() => ({ ok: true, state: VAULTS })));
    expect(await openThroughSwitch()).toEqual([]);
  });

  it("words a command the shell refuses itself rather than passing on its details", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mockShell();
    expect(await openThroughSwitch()).toEqual(["Could not open that vault."]);
  });

  it("words an answer its row does not parse as a fault", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mockShell({ answer: () => ({ ok: "maybe" }), command: APP_COMMANDS.vaults.open.command });
    expect(await openThroughSwitch()).toEqual(["Could not open that vault."]);
  });
});
