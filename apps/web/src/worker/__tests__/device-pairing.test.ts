import { cloudErrorSchema } from "@repo/cloud-contract/errors";
import {
  DEVICE_PAIR_PURPOSE,
  listDevicesResponseSchema,
  redeemDeviceResponseSchema,
} from "@repo/cloud-contract/pairing";
import { eq } from "drizzle-orm";
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  deviceHeaders,
  mintCode,
  ORIGIN,
  pairDevice,
  sessionHeaders,
  signUpUser,
} from "./cloud-helpers";
import { createDb } from "../db/client";
import { device, pairingCode } from "../db/schema";

// The pairing flow end to end against the real Worker + D1: mint (session) →
// redeem (the code is the credential) → the durable device credential works on
// the device surface — and every refusal on the way.

async function redeem(code: string, deviceName = "Test Laptop"): Promise<Response> {
  return await SELF.fetch(`${ORIGIN}/v1/device/redeem`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, deviceName }),
  });
}

function pull(credential: string): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/v1/sync/pull?afterSeq=0`, { headers: deviceHeaders(credential) });
}

describe("device pairing", () => {
  it("mints and redeems: the credential reaches the sync surface", async () => {
    const { bearer } = await signUpUser("pair-ok@example.test");
    const code = await mintCode(bearer);

    const redeemed = redeemDeviceResponseSchema.parse(await (await redeem(code)).json());
    expect(redeemed.credential.startsWith("igd_")).toBe(true);

    expect((await pull(redeemed.credential)).status).toBe(200);

    // The credential is stored only as a hash — the plaintext appears nowhere.
    const row = await createDb(env.DB)
      .select()
      .from(device)
      .where(eq(device.id, redeemed.deviceId))
      .get();
    expect(row?.name).toBe("Test Laptop");
    expect(row?.credentialHash).not.toContain(redeemed.credential.slice(4));
  });

  it("refuses to mint without a session", async () => {
    const response = await SELF.fetch(`${ORIGIN}/v1/device/code`, { method: "POST" });
    expect(response.status).toBe(401);
    expect(cloudErrorSchema.parse(await response.json()).error.code).toBe("unauthorized");
  });

  it("consumes a code exactly once", async () => {
    const { bearer } = await signUpUser("pair-once@example.test");
    const code = await mintCode(bearer);

    expect((await redeem(code)).status).toBe(200);
    const second = await redeem(code);
    expect(second.status).toBe(409);
    expect(cloudErrorSchema.parse(await second.json()).error.code).toBe("code-consumed");
  });

  it("refuses an expired code", async () => {
    const { bearer } = await signUpUser("pair-expired@example.test");
    const code = await mintCode(bearer);
    await createDb(env.DB)
      .update(pairingCode)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(pairingCode.code, code));

    const response = await redeem(code);
    expect(response.status).toBe(410);
    expect(cloudErrorSchema.parse(await response.json()).error.code).toBe("code-expired");
  });

  it("refuses an unknown code without touching anything", async () => {
    const response = await redeem("XXXX-XXXX");
    expect(response.status).toBe(404);
    expect(cloudErrorSchema.parse(await response.json()).error.code).toBe("invalid-code");
  });

  it("refuses a code minted for a different purpose", async () => {
    const { bearer } = await signUpUser("pair-purpose@example.test");
    const code = await mintCode(bearer);
    await createDb(env.DB)
      .update(pairingCode)
      .set({ purpose: "something-else" })
      .where(eq(pairingCode.code, code));

    expect((await redeem(code)).status).toBe(404);
    // The purpose value the mint writes is the one redeem demands.
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
    // A SESSION bearer is not a device credential — the two vocabularies
    // must not shadow each other.
    const response = await SELF.fetch(`${ORIGIN}/v1/sync/pull?afterSeq=0`, {
      headers: sessionHeaders(bearer),
    });
    expect(response.status).toBe(401);
  });
});
