import { cloudErrorSchema } from "@repo/api/cloud/errors";
import {
  DEVICE_API_PATHS,
  listDevicesResponseSchema,
  revokeDeviceResponseSchema,
} from "@repo/api/cloud/device/device-schema";
import { SYNC_WS_REVOKED_CLOSE_CODE } from "@repo/api/cloud/sync/sync-ws";
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  deviceHeaders,
  emitted,
  loginDevice,
  openSocket,
  ORIGIN,
  signUpUser,
} from "./cloud-helpers";

const listAs = async (credential: string): Promise<Response> =>
  await SELF.fetch(`${ORIGIN}${DEVICE_API_PATHS.list}`, { headers: deviceHeaders(credential) });

const revokeAs = async (credential: string, deviceId: string): Promise<Response> =>
  await SELF.fetch(`${ORIGIN}${DEVICE_API_PATHS.revoke}`, {
    body: JSON.stringify({ deviceId }),
    headers: { ...deviceHeaders(credential), "content-type": "application/json" },
    method: "POST",
  });

const pullStatus = async (credential: string): Promise<number> => {
  const response = await SELF.fetch(`${ORIGIN}/v1/sync/pull?afterSeq=0`, {
    headers: deviceHeaders(credential),
  });
  return response.status;
};

const expectUnauthorized = async (response: Response): Promise<void> => {
  expect(response.status).toBe(401);
  expect(emitted(cloudErrorSchema, await response.text()).error.code).toBe("unauthorized");
};

// the app holds its own credential and no session, so its Settings list and revoke with that
describe("a device managing its account's devices", () => {
  it("lists its own account's devices and no one else's", async () => {
    const { bearer } = await signUpUser("manage-list@example.test");
    const mac = await loginDevice(bearer, "Mac");
    await loginDevice(bearer, "Phone");
    const stranger = await signUpUser("manage-list-stranger@example.test");
    await loginDevice(stranger.bearer, "Stranger's Mac");

    const response = await listAs(mac.credential);
    expect(response.status).toBe(200);
    const { devices } = emitted(listDevicesResponseSchema, await response.text());
    expect(devices.map((row) => row.name)).toEqual(["Mac", "Phone"]);
    expect(devices.every((row) => row.revokedAt === null)).toBe(true);
  });

  it("revokes a sibling: its next request is refused and its live socket is closed", async () => {
    const { bearer } = await signUpUser("manage-revoke@example.test");
    const mac = await loginDevice(bearer, "Mac");
    const phone = await loginDevice(bearer, "Lost Phone");
    const socket = await openSocket(phone.credential, "mobile");
    // oxlint-disable-next-line promise/avoid-new -- the close code arrives as a socket event, which only a promise can hand to an await
    const closed = new Promise<number>((resolve) => {
      socket.socket.addEventListener("close", (close) => {
        resolve(close.code);
      });
    });

    const revoked = await revokeAs(mac.credential, phone.deviceId);
    expect(revoked.status).toBe(200);
    expect(emitted(revokeDeviceResponseSchema, await revoked.text())).toEqual({ revoked: true });

    expect(await closed).toBe(SYNC_WS_REVOKED_CLOSE_CODE);
    expect(await pullStatus(phone.credential)).toBe(401);
    expect(await pullStatus(mac.credential)).toBe(200);
    const listed = await listAs(mac.credential);
    const { devices } = emitted(listDevicesResponseSchema, await listed.text());
    expect(devices.find((row) => row.id === phone.deviceId)?.revokedAt).not.toBeNull();
  });

  it("answers another account's device as not found, and leaves it signed in", async () => {
    const alice = await signUpUser("manage-alice@example.test");
    const mallory = await signUpUser("manage-mallory@example.test");
    const alicesMac = await loginDevice(alice.bearer, "Alice's Mac");
    const mallorysMac = await loginDevice(mallory.bearer, "Mallory's Mac");

    const response = await revokeAs(mallorysMac.credential, alicesMac.deviceId);
    expect(response.status).toBe(404);
    expect(emitted(cloudErrorSchema, await response.text()).error.code).toBe("not-found");
    expect(await pullStatus(alicesMac.credential)).toBe(200);
  });

  it("refuses a revoked credential both routes, in the words every device route uses", async () => {
    const { bearer } = await signUpUser("manage-revoked@example.test");
    const mac = await loginDevice(bearer, "Mac");
    const phone = await loginDevice(bearer, "Phone");
    const revoked = await revokeAs(mac.credential, phone.deviceId);
    expect(revoked.status).toBe(200);

    const listed = await listAs(phone.credential);
    expect(listed.status).toBe(401);
    expect(emitted(cloudErrorSchema, await listed.text()).error.message).toBe(
      "No valid device credential.",
    );
    await expectUnauthorized(await revokeAs(phone.credential, mac.deviceId));
    expect(await pullStatus(mac.credential)).toBe(200);
  });

  it("refuses a credential no device was ever given", async () => {
    await expectUnauthorized(await listAs(`igd_${"0".repeat(64)}`));
  });
});
