import { cloudErrorSchema } from "@repo/api/cloud/errors";
import {
  DEVICE_PAIR_PURPOSE,
  generatePkceVerifier,
  listDevicesResponseSchema,
  redeemDeviceResponseSchema,
} from "@repo/api/cloud/pairing/pairing-schema";
import { and, eq, isNull } from "drizzle-orm";
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  deviceHeaders,
  mintCode,
  ORIGIN,
  pairDevice,
  sessionHeaders,
  signUpUser,
  userIdOf,
} from "./cloud-helpers";
import { createDb } from "../db/client";
import { device, pairingCode } from "../db/schema";

async function redeem(
  code: string,
  verifier: string,
  deviceName = "Test Laptop",
): Promise<Response> {
  return await SELF.fetch(`${ORIGIN}/v1/device/redeem`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, deviceName, verifier }),
  });
}

function pull(credential: string): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/v1/sync/pull?afterSeq=0`, { headers: deviceHeaders(credential) });
}

describe("device pairing", () => {
  it("mints and redeems: the credential reaches the sync surface", async () => {
    const { bearer } = await signUpUser("pair-ok@example.test");
    const { code, verifier } = await mintCode(bearer);

    const redeemed = redeemDeviceResponseSchema.parse(await (await redeem(code, verifier)).json());
    expect(redeemed.credential.startsWith("igd_")).toBe(true);

    expect((await pull(redeemed.credential)).status).toBe(200);

    const row = await createDb(env.DB)
      .select()
      .from(device)
      .where(eq(device.id, redeemed.deviceId))
      .get();
    expect(row?.name).toBe("Test Laptop");
    expect(row?.credentialHash).not.toContain(redeemed.credential.slice(4));
  });

  it("refuses a redeem whose verifier does not match the minted challenge", async () => {
    const { bearer } = await signUpUser("pair-pkce@example.test");
    const { code } = await mintCode(bearer);

    const wrong = await redeem(code, generatePkceVerifier());
    expect(wrong.status).toBe(404);
    expect(cloudErrorSchema.parse(await wrong.json()).error.code).toBe("invalid-code");

    const { code: code2, verifier } = await mintCode(bearer);
    expect((await redeem(code2, verifier)).status).toBe(200);
  });

  it("refuses a redeem carrying no verifier at all", async () => {
    const { bearer } = await signUpUser("pair-noverifier@example.test");
    const { code } = await mintCode(bearer);
    const response = await SELF.fetch(`${ORIGIN}/v1/device/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, deviceName: "No Verifier" }),
    });
    expect(response.status).toBe(400);
    expect(cloudErrorSchema.parse(await response.json()).error.code).toBe("bad-request");
  });

  it("refuses to mint without a session", async () => {
    const response = await SELF.fetch(`${ORIGIN}/v1/device/code`, { method: "POST" });
    expect(response.status).toBe(401);
    expect(cloudErrorSchema.parse(await response.json()).error.code).toBe("unauthorized");
  });

  it("refuses to mint a code with a plain (non-S256) challenge", async () => {
    const { bearer } = await signUpUser("pair-plain@example.test");
    const response = await SELF.fetch(`${ORIGIN}/v1/device/code`, {
      method: "POST",
      headers: { ...sessionHeaders(bearer), "content-type": "application/json" },
      body: JSON.stringify({ challenge: "a".repeat(43), challengeMethod: "plain" }),
    });
    expect(response.status).toBe(400);
    expect(cloudErrorSchema.parse(await response.json()).error.code).toBe("bad-request");
  });

  it("consumes a code exactly once", async () => {
    const { bearer } = await signUpUser("pair-once@example.test");
    const { code, verifier } = await mintCode(bearer);

    expect((await redeem(code, verifier)).status).toBe(200);
    const second = await redeem(code, verifier);
    expect(second.status).toBe(409);
    expect(cloudErrorSchema.parse(await second.json()).error.code).toBe("code-consumed");
  });

  it("settles simultaneous redeems on exactly one device", async () => {
    const { bearer } = await signUpUser("pair-race@example.test");
    const { code, verifier } = await mintCode(bearer);

    const responses = await Promise.all([
      redeem(code, verifier, "Racer A"),
      redeem(code, verifier, "Racer B"),
      redeem(code, verifier, "Racer C"),
    ]);
    const statuses = responses.map((response) => response.status).toSorted((a, b) => a - b);
    expect(statuses).toEqual([200, 409, 409]);

    const { devices } = listDevicesResponseSchema.parse(
      await (
        await SELF.fetch(`${ORIGIN}/v1/device/list`, { headers: sessionHeaders(bearer) })
      ).json(),
    );
    expect(devices).toHaveLength(1);

    const winner = responses.find((response) => response.status === 200);
    if (winner === undefined) throw new Error("no winner");
    const credential = redeemDeviceResponseSchema.parse(await winner.json()).credential;
    expect((await pull(credential)).status).toBe(200);
  });

  it("refuses an expired code", async () => {
    const { bearer } = await signUpUser("pair-expired@example.test");
    const { code, verifier } = await mintCode(bearer);
    await createDb(env.DB)
      .update(pairingCode)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(pairingCode.code, code));

    const response = await redeem(code, verifier);
    expect(response.status).toBe(410);
    expect(cloudErrorSchema.parse(await response.json()).error.code).toBe("code-expired");
  });

  it("refuses to create a twenty-first active device", async () => {
    const { bearer } = await signUpUser("pair-cap@example.test");
    const userId = await userIdOf(bearer);
    const db = createDb(env.DB);
    for (let index = 0; index < 20; index += 1) {
      await db.insert(device).values({
        id: `cap-device-${index}`,
        userId,
        name: `Device ${index}`,
        credentialHash: `hash-${index}`,
        createdAt: new Date(),
      });
    }

    const { code, verifier } = await mintCode(bearer);
    const response = await redeem(code, verifier, "One Too Many");
    expect(response.status).toBe(409);
    expect(cloudErrorSchema.parse(await response.json()).error.code).toBe("device-limit");

    const active = await db
      .select()
      .from(device)
      .where(and(eq(device.userId, userId), isNull(device.revokedAt)))
      .all();
    expect(active).toHaveLength(20);

    await SELF.fetch(`${ORIGIN}/v1/device/revoke`, {
      method: "POST",
      headers: { ...sessionHeaders(bearer), "content-type": "application/json" },
      body: JSON.stringify({ deviceId: "cap-device-0" }),
    });
    const room = await mintCode(bearer);
    expect((await redeem(room.code, room.verifier, "Now There's Room")).status).toBe(200);
  });

  // which guard fires is not asserted: this runtime may serialize the pair, while a deployment lands them on different isolates
  it("cannot be raced past the cap with two codes minted under it", async () => {
    const { bearer } = await signUpUser("pair-cap-race@example.test");
    const userId = await userIdOf(bearer);
    const db = createDb(env.DB);
    for (let index = 0; index < 19; index += 1) {
      await db.insert(device).values({
        id: `race-device-${index}`,
        userId,
        name: `Device ${index}`,
        credentialHash: `race-hash-${index}`,
        createdAt: new Date(),
      });
    }

    const [first, second] = [await mintCode(bearer), await mintCode(bearer)];
    const statuses = (
      await Promise.all([
        redeem(first.code, first.verifier, "Racer A"),
        redeem(second.code, second.verifier, "Racer B"),
      ])
    )
      .map((response) => response.status)
      .toSorted((a, b) => a - b);
    expect(statuses).toEqual([200, 409]);

    const active = await db
      .select()
      .from(device)
      .where(and(eq(device.userId, userId), isNull(device.revokedAt)))
      .all();
    expect(active).toHaveLength(20);
  });

  it("refuses an unknown code without touching anything", async () => {
    const response = await redeem("XXXX-XXXX", generatePkceVerifier());
    expect(response.status).toBe(404);
    expect(cloudErrorSchema.parse(await response.json()).error.code).toBe("invalid-code");
  });

  it("refuses a code minted for a different purpose", async () => {
    const { bearer } = await signUpUser("pair-purpose@example.test");
    const { code, verifier } = await mintCode(bearer);
    await createDb(env.DB)
      .update(pairingCode)
      .set({ purpose: "something-else" })
      .where(eq(pairingCode.code, code));

    expect((await redeem(code, verifier)).status).toBe(404);
    expect(DEVICE_PAIR_PURPOSE).toBe("device-pair");
  });

  it("revocation bites on the very next request", async () => {
    const { bearer } = await signUpUser("pair-revoke@example.test");
    const { deviceId, credential } = await pairDevice(bearer, "Doomed Laptop");
    expect((await pull(credential)).status).toBe(200);

    const revoke = await SELF.fetch(`${ORIGIN}/v1/device/revoke`, {
      method: "POST",
      headers: { ...sessionHeaders(bearer), "content-type": "application/json" },
      body: JSON.stringify({ deviceId }),
    });
    expect(revoke.status).toBe(200);

    const after = await pull(credential);
    expect(after.status).toBe(401);
  });

  it("lists the account's devices, revoked ones included", async () => {
    const { bearer } = await signUpUser("pair-list@example.test");
    const first = await pairDevice(bearer, "Laptop");
    await pairDevice(bearer, "Desktop");
    await SELF.fetch(`${ORIGIN}/v1/device/revoke`, {
      method: "POST",
      headers: { ...sessionHeaders(bearer), "content-type": "application/json" },
      body: JSON.stringify({ deviceId: first.deviceId }),
    });

    const response = await SELF.fetch(`${ORIGIN}/v1/device/list`, {
      headers: sessionHeaders(bearer),
    });
    const { devices } = listDevicesResponseSchema.parse(await response.json());
    expect(devices.map((d) => d.name)).toEqual(["Laptop", "Desktop"]);
    expect(devices[0]?.revokedAt).not.toBeNull();
    expect(devices[1]?.revokedAt).toBeNull();
  });

  it("never lets one account revoke another's device", async () => {
    const alice = await signUpUser("pair-alice@example.test");
    const mallory = await signUpUser("pair-mallory@example.test");
    const { deviceId, credential } = await pairDevice(alice.bearer, "Alice's Laptop");

    const response = await SELF.fetch(`${ORIGIN}/v1/device/revoke`, {
      method: "POST",
      headers: { ...sessionHeaders(mallory.bearer), "content-type": "application/json" },
      body: JSON.stringify({ deviceId }),
    });
    expect(response.status).toBe(404);
    expect((await pull(credential)).status).toBe(200);
  });

  it("refuses the sync surface without a device credential", async () => {
    const { bearer } = await signUpUser("pair-nodevice@example.test");
    const response = await SELF.fetch(`${ORIGIN}/v1/sync/pull?afterSeq=0`, {
      headers: sessionHeaders(bearer),
    });
    expect(response.status).toBe(401);
  });
});
