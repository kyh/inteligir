// @vitest-environment jsdom

import { emit } from "@tauri-apps/api/event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { APP_COMMANDS, UPDATE_STATE_EVENT } from "./ipc-contract";
import type { UpdateState } from "./update-state";
import { shellUpdates, underShell } from "./shell-commands";
import { clearShell, mockShell, reply } from "./test-support/mock-shell";

afterEach(clearShell);

const IDLE: UpdateState = { checkedAt: null, currentVersion: "0.6.0", status: "idle" };

describe("the shell's door", () => {
  it("is shut outside the shell", () => {
    expect(underShell()).toBe(false);
    mockShell();
    expect(underShell()).toBe(true);
  });

  it("asks the row's command, and hands back the parsed answer", async () => {
    const asked = vi.fn<() => UpdateState>(() => IDLE);
    mockShell(reply(APP_COMMANDS.updates.getState)(asked));
    expect(await shellUpdates.getState()).toEqual(IDLE);
    expect(asked).toHaveBeenCalledOnce();
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
