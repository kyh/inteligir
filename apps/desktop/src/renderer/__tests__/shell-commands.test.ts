// @vitest-environment jsdom

import { emit } from "@tauri-apps/api/event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { APP_COMMANDS, UPDATE_STATE_EVENT } from "../../ipc-contract";
import type { UpdateState } from "../../update-state";
import type { VaultsState } from "../../vaults-state";
import { shellUpdates, shellVaults, underShell } from "../shell-commands";
import { clearShell, mockShell, reply } from "./mock-shell";

afterEach(clearShell);

const IDLE: UpdateState = { checkedAt: null, currentVersion: "0.6.0", status: "idle" };

const VAULTS: VaultsState = {
  blocked: null,
  current: { name: "Work", path: "/home/me/Work" },
  recent: [],
};

describe("the shell's door", () => {
  it("is shut outside the shell", () => {
    expect(underShell()).toBe(false);
    mockShell();
    expect(underShell()).toBe(true);
  });

  it("asks the row's command with the row's arguments, and hands back the parsed answer", async () => {
    const open = vi.fn<(args: { path: string }) => VaultsState>(() => VAULTS);
    mockShell(reply(APP_COMMANDS.vaults.open)((args) => ({ ok: true, state: open(args) })));
    expect(await shellVaults.open({ path: "/home/me/Work" })).toEqual({ ok: true, state: VAULTS });
    expect(open).toHaveBeenCalledWith({ path: "/home/me/Work" });
  });

  it("rejects an answer its row does not parse", async () => {
    mockShell({
      answer: () => ({ checkedAt: null, currentVersion: "0.6.0", status: "rebooting" }),
      command: APP_COMMANDS.updates.getState.command,
    });
    await expect(shellUpdates.getState()).rejects.toBeInstanceOf(ZodError);
  });

  it("rejects a command the shell refuses, as a fault", async () => {
    mockShell();
    await expect(shellUpdates.check()).rejects.toThrow(/not allowed/u);
  });

  it("hands a listener only the frames its row parses", async () => {
    mockShell();
    const heard: UpdateState[] = [];
    const stop = shellUpdates.onState((state) => {
      heard.push(state);
    });
    await emit(UPDATE_STATE_EVENT.event, { ...IDLE, status: "rebooting" });
    await emit(UPDATE_STATE_EVENT.event, IDLE);
    stop();
    expect(heard).toEqual([IDLE]);
  });
});
