// `account.devices` asked with a device's own credential: the app holds no session, so its
// Settings › Account lists and revokes the account's devices with that.

import { SOCKET_REVOKED_CLOSE_CODE } from "@repo/contract/cloud/library/library-socket";
import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import {
  deviceHeaders,
  loginDevice,
  openSocket,
  sessionHeaders,
  signUpUser,
  v1Link,
} from "./test-support/cloud-helpers";

const as = (credential: string) => v1Link(deviceHeaders(credential));

const UNAUTHORIZED = { code: "UNAUTHORIZED", defined: true, status: 401 };

describe("a device managing its account's devices", () => {
  // the sign-up's session is listed beside the credentials, named for the browser it came from
  it("lists its own account's devices and no one else's", async () => {
    const { cookie } = await signUpUser("manage-list@example.test");
    const mac = await loginDevice(cookie, "Mac");
    await loginDevice(cookie, "Phone");
    const stranger = await signUpUser("manage-list-stranger@example.test");
    await loginDevice(stranger.cookie, "Stranger's Mac");

    const { devices } = await as(mac.credential).account.devices.list();
    expect(devices.map((row) => row.name)).toStrictEqual(["Chrome on Mac", "Mac", "Phone"]);
    expect(devices.every((row) => row.revokedAt === null)).toBe(true);
  });

  it("marks the device or the session that asks", async () => {
    const { cookie } = await signUpUser("manage-current@example.test");
    const mac = await loginDevice(cookie, "Mac");
    await loginDevice(cookie, "Phone");

    const { devices } = await as(mac.credential).account.devices.list();
    expect(devices.map(({ current, name }) => ({ current, name }))).toStrictEqual([
      { current: false, name: "Chrome on Mac" },
      { current: true, name: "Mac" },
      { current: false, name: "Phone" },
    ]);

    const site = await v1Link(sessionHeaders(cookie)).account.devices.list();
    expect(site.devices.map((row) => row.current)).toStrictEqual([true, false, false]);
  });

  // the sign-in's row is a raw insert beside drizzle's writes, so both must spell the same unit
  it("dates a sign-in and its first call in the instant each happened", async () => {
    const before = Date.now();
    const { cookie } = await signUpUser("manage-dates@example.test");
    const mac = await loginDevice(cookie, "Mac");
    const { devices } = await as(mac.credential).account.devices.list();
    const row = devices.find(({ name }) => name === "Mac");
    const after = Date.now();
    for (const at of [row?.createdAt, row?.lastSeenAt]) {
      expect(at).toBeGreaterThanOrEqual(before);
      expect(at).toBeLessThanOrEqual(after);
    }
  });

  it("revokes a sibling: its next call is refused and its live socket is closed", async () => {
    const { cookie } = await signUpUser("manage-revoke@example.test");
    const mac = await loginDevice(cookie, "Mac");
    const phone = await loginDevice(cookie, "Lost Phone");
    const socket = await openSocket(phone.credential);
    // oxlint-disable-next-line promise/avoid-new -- the close code arrives as a socket event, which only a promise can hand to an await
    const closed = new Promise<number>((resolve) => {
      socket.socket.addEventListener("close", (close) => {
        resolve(close.code);
      });
    });

    await expect(
      as(mac.credential).account.devices.revoke({ deviceId: phone.deviceId }),
    ).resolves.toStrictEqual({
      revoked: true,
    });

    await expect(closed).resolves.toBe(SOCKET_REVOKED_CLOSE_CODE);
    const lost = as(phone.credential);
    await expect(lost.refusalOf(lost.account.devices.list())).resolves.toMatchObject(UNAUTHORIZED);
    const { devices } = await as(mac.credential).account.devices.list();
    expect(devices.find((row) => row.id === phone.deviceId)?.revokedAt).not.toBeNull();
  });

  it("closes a revoked sibling's live socket even when its budgets can't be dropped", async () => {
    const { cookie } = await signUpUser("manage-revoke-fault@example.test");
    const mac = await loginDevice(cookie, "Mac");
    const phone = await loginDevice(cookie, "Lost Phone");
    const socket = await openSocket(phone.credential);
    // oxlint-disable-next-line promise/avoid-new -- the close code arrives as a socket event, which only a promise can hand to an await
    const closed = new Promise<number>((resolve) => {
      socket.socket.addEventListener("close", (close) => {
        resolve(close.code);
      });
    });
    const prepare = env.DB.prepare.bind(env.DB);
    const faulty = vi.spyOn(env.DB, "prepare").mockImplementation((query) => {
      if (query.startsWith('delete from "rate_limit"')) {
        throw new Error("D1 went away");
      }
      return prepare(query);
    });

    await expect(
      as(mac.credential).account.devices.revoke({ deviceId: phone.deviceId }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    faulty.mockRestore();

    await expect(closed).resolves.toBe(SOCKET_REVOKED_CLOSE_CODE);
  });

  it("answers another account's device as not found, and leaves it signed in", async () => {
    const alice = await signUpUser("manage-alice@example.test");
    const mallory = await signUpUser("manage-mallory@example.test");
    const alicesMac = await loginDevice(alice.cookie, "Alice's Mac");
    const mallorysMac = await loginDevice(mallory.cookie, "Mallory's Mac");

    const link = as(mallorysMac.credential);
    await expect(
      link.refusalOf(link.account.devices.revoke({ deviceId: alicesMac.deviceId })),
    ).resolves.toMatchObject({ code: "NOT_FOUND", defined: true, status: 404 });
    await expect(as(alicesMac.credential).account.devices.list()).resolves.toMatchObject({
      devices: [{ name: "Chrome on Mac" }, { name: "Alice's Mac", revokedAt: null }],
    });
  });

  it("refuses a revoked credential both rows, in the words every signed row uses", async () => {
    const { cookie } = await signUpUser("manage-revoked@example.test");
    const mac = await loginDevice(cookie, "Mac");
    const phone = await loginDevice(cookie, "Phone");
    await as(mac.credential).account.devices.revoke({ deviceId: phone.deviceId });

    const revoked = as(phone.credential);
    await expect(revoked.refusalOf(revoked.account.devices.list())).resolves.toMatchObject({
      ...UNAUTHORIZED,
      message: "You're signed out. Sign in again.",
    });
    await expect(
      revoked.refusalOf(revoked.account.devices.revoke({ deviceId: mac.deviceId })),
    ).resolves.toMatchObject(UNAUTHORIZED);
    const { devices } = await as(mac.credential).account.devices.list();
    expect(devices.map(({ name }) => name)).toStrictEqual(["Chrome on Mac", "Mac", "Phone"]);
  });

  it("refuses a credential no device was ever given", async () => {
    const forged = as(`igd_${"0".repeat(64)}`);
    await expect(forged.refusalOf(forged.account.devices.list())).resolves.toMatchObject(
      UNAUTHORIZED,
    );
  });
});
