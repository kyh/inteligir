import { describe, expect, it } from "vitest";
import { INVOKE_ROUTES, SOCKET_ORIGIN_CHANNEL, UPDATE_STATE_PUSH } from "../../ipc-contract";

const channels = [
  ...Object.values(INVOKE_ROUTES).flatMap((arm) =>
    Object.values(arm).map((route) => route.channel),
  ),
  UPDATE_STATE_PUSH.channel,
  SOCKET_ORIGIN_CHANNEL,
];

describe("the bridge's channels", () => {
  it("names each channel once, because a second `ipcMain.handle` on a channel throws at boot", () => {
    const repeated = channels.filter((channel, index) => channels.indexOf(channel) !== index);
    expect(repeated, "ipc-contract.ts: a channel may be declared by one row only").toEqual([]);
  });
});
