import {
  changesPath,
  devicesPath,
  enrollOfferPath,
  enrollPath,
  formatBearer,
  manifestPath,
  revokePath,
  type DeviceListResponse,
  type EnrollOfferResponse,
  type EnrollResponse,
  type RevokeResponse,
} from "@repo/notes/sync/wire";
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { MAX_ASSERTION_LIFETIME_SECONDS, MAX_CLOCK_SKEW_SECONDS } from "../src/device-assertion";
import {
  ASSERTION_LIFETIME_SECONDS,
  createDevice,
  createEnrollOffer,
  nowSeconds,
  type TestDevice,
} from "./device-helpers";

// ---------------------------------------------------------------------------
// The device-key identity path, driven against the real in-process Worker + DO.
// Every credential here is a genuine Ed25519 assertion in the wire format the
// clients will mint — nothing is stubbed but the TCP hop.
//
// D1 and Better Auth are untouched by every test in this file: the device path
// runs ALONGSIDE the account path, and the account tests in sync.test.ts prove
// the other half still works.
// ---------------------------------------------------------------------------

const ORIGIN = "https://inteligir-cloud.workers.dev";

const json = { "content-type": "application/json" };

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

function manifest(device: TestDevice, vaultId: string): Promise<Response> {
  return device
    .auth(vaultId)
    .then((headers) => SELF.fetch(ORIGIN + manifestPath(vaultId), { headers }));
}

/** Found `device.vaultId` by touching it once — founding is a side effect of any route. */
async function found(device: TestDevice): Promise<void> {
  const res = await manifest(device, device.vaultId);
  if (res.status !== 200) throw new Error(`founding failed: ${res.status} ${await res.text()}`);
}

async function offer(host: TestDevice, vaultId: string, notAfter?: number) {
  const pairing = await createEnrollOffer();
  const res = await SELF.fetch(ORIGIN + enrollOfferPath(vaultId), {
    method: "POST",
    headers: { ...json, ...(await host.auth(vaultId)) },
    body: JSON.stringify({
      enrollId: pairing.enrollId,
      notAfter: notAfter ?? nowSeconds() + 600,
    }),
  });
  return { pairing, res };
}

function redeem(vaultId: string, s: string, joiner: TestDevice, deviceName = "Phone") {
  return SELF.fetch(ORIGIN + enrollPath(vaultId), {
    method: "POST",
    headers: json,
    body: JSON.stringify({ s, publicKey: joiner.publicKey, deviceName }),
  });
}

describe("founding", () => {
  it("a device founds the vault its own key names, and lands on the roster", async () => {
    const desktop = await createDevice();
    expect(desktop.vaultId).toMatch(/^v1[a-z2-7]{52}$/);

    const res = await manifest(desktop, desktop.vaultId);
    expect(res.status).toBe(200);

    const roster = await readJson<DeviceListResponse>(
      await SELF.fetch(ORIGIN + devicesPath(desktop.vaultId), {
        headers: await desktop.auth(desktop.vaultId),
      }),
    );
    expect(roster.devices).toHaveLength(1);
    expect(roster.devices[0]?.publicKey).toBe(desktop.publicKey);
    expect(roster.devices[0]?.revokedAt).toBeNull();
  });

  it("a device cannot found a vault its key does not name (403)", async () => {
    const founder = await createDevice();
    const stranger = await createDevice();

    // The stranger signs a perfectly valid assertion for the founder's vault.
    const res = await SELF.fetch(ORIGIN + manifestPath(founder.vaultId), {
      headers: await stranger.auth(founder.vaultId),
    });
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("not-founder");
  });

  it("a valid signature that is not on the roster is refused (403)", async () => {
    const founder = await createDevice();
    await found(founder);

    const outsider = await createDevice();
    const res = await SELF.fetch(ORIGIN + manifestPath(founder.vaultId), {
      headers: await outsider.auth(founder.vaultId),
    });
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("device-not-enrolled");
  });
});

describe("assertion verification", () => {
  it("an expired assertion says so, so a skewed clock is diagnosable (401)", async () => {
    const device = await createDevice();
    const res = await SELF.fetch(ORIGIN + manifestPath(device.vaultId), {
      headers: await device.auth(device.vaultId, {
        iat: nowSeconds() - ASSERTION_LIFETIME_SECONDS - 60,
      }),
    });
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("assertion-expired");
  });

  it("an assertion from a device whose clock runs fast is refused", async () => {
    const device = await createDevice();
    const res = await SELF.fetch(ORIGIN + manifestPath(device.vaultId), {
      headers: await device.auth(device.vaultId, {
        iat: nowSeconds() + MAX_CLOCK_SKEW_SECONDS + 30,
      }),
    });
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("assertion-not-yet-valid");
  });

  it("an over-long lifetime is refused rather than truncated", async () => {
    const device = await createDevice();
    const res = await SELF.fetch(ORIGIN + manifestPath(device.vaultId), {
      headers: await device.auth(device.vaultId, {
        lifetimeSeconds: MAX_ASSERTION_LIFETIME_SECONDS + 1,
      }),
    });
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("assertion-lifetime");
  });

  it("an assertion minted for one vault does not work on another", async () => {
    const alice = await createDevice();
    const bob = await createDevice();
    await found(alice);
    await found(bob);

    // Alice's key, Alice's signature — but bound to Alice's vault, sent to Bob's.
    const res = await SELF.fetch(ORIGIN + manifestPath(bob.vaultId), {
      headers: await alice.auth(alice.vaultId),
    });
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("vault-mismatch");
  });

  it("a payload signed by a different key is refused", async () => {
    const device = await createDevice();
    const forger = await createDevice();
    const res = await SELF.fetch(ORIGIN + manifestPath(device.vaultId), {
      headers: await device.auth(device.vaultId, { signWith: forger }),
    });
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("bad-signature");
  });

  it("a forged x-device header buys nothing — both sides read the raw Authorization", async () => {
    const owner = await createDevice();
    const attacker = await createDevice();
    await found(owner);

    // A VALID assertion for the attacker's own vault, plus a header claiming to
    // be the owner's key. Nothing in the Worker or the DO reads x-device, so the
    // credential in Authorization is the only thing that counts.
    const res = await SELF.fetch(ORIGIN + manifestPath(owner.vaultId), {
      headers: {
        ...(await attacker.auth(attacker.vaultId)),
        "x-device": owner.publicKey,
      },
    });
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("vault-mismatch");

    // And with the assertion correctly bound to the owner's vault it is still
    // just an unenrolled key.
    const bound = await SELF.fetch(ORIGIN + manifestPath(owner.vaultId), {
      headers: {
        ...(await attacker.auth(owner.vaultId)),
        "x-device": owner.publicKey,
      },
    });
    expect(bound.status).toBe(403);
  });

  it("a garbage bearer never reaches a Durable Object (401)", async () => {
    const device = await createDevice();
    const res = await SELF.fetch(ORIGIN + manifestPath(device.vaultId), {
      headers: { authorization: formatBearer("not.an.assertion") },
    });
    expect(res.status).toBe(401);
  });
});

describe("enrollment", () => {
  it("an enrolled device offers, the joining device redeems, and then syncs", async () => {
    const desktop = await createDevice();
    const phone = await createDevice();
    await found(desktop);

    const { pairing, res } = await offer(desktop, desktop.vaultId);
    expect(res.status).toBe(200);
    const offered = await readJson<EnrollOfferResponse>(res);
    expect(offered.notAfter).toBeGreaterThan(nowSeconds());

    // Unauthenticated by design: the secret is the auth.
    const enrolled = await readJson<EnrollResponse>(
      await redeem(desktop.vaultId, pairing.s, phone),
    );
    expect(enrolled.ok).toBe(true);

    // The phone now authenticates on its own key.
    const res2 = await SELF.fetch(ORIGIN + manifestPath(desktop.vaultId), {
      headers: await phone.auth(desktop.vaultId),
    });
    expect(res2.status).toBe(200);

    const roster = await readJson<DeviceListResponse>(
      await SELF.fetch(ORIGIN + devicesPath(desktop.vaultId), {
        headers: await desktop.auth(desktop.vaultId),
      }),
    );
    expect(roster.devices.map((d) => d.publicKey).toSorted()).toEqual(
      [desktop.publicKey, phone.publicKey].toSorted(),
    );
    expect(roster.devices.find((d) => d.publicKey === phone.publicKey)?.name).toBe("Phone");
  });

  it("a consumed offer cannot be replayed, and the replayer stays off the roster", async () => {
    const desktop = await createDevice();
    const phone = await createDevice();
    const attacker = await createDevice();
    await found(desktop);

    const { pairing } = await offer(desktop, desktop.vaultId);
    expect(
      (await readJson<EnrollResponse>(await redeem(desktop.vaultId, pairing.s, phone))).ok,
    ).toBe(true);

    const replay = await readJson<EnrollResponse>(
      await redeem(desktop.vaultId, pairing.s, attacker),
    );
    expect(replay.ok).toBe(false);

    const denied = await SELF.fetch(ORIGIN + manifestPath(desktop.vaultId), {
      headers: await attacker.auth(desktop.vaultId),
    });
    expect(denied.status).toBe(403);
  });

  it("wrong, expired and consumed all answer identically — no offer oracle", async () => {
    const desktop = await createDevice();
    await found(desktop);

    const { pairing } = await offer(desktop, desktop.vaultId);
    const joiner = await createDevice();
    await redeem(desktop.vaultId, pairing.s, joiner);

    const wrong = await createEnrollOffer();
    const answers = await Promise.all([
      redeem(desktop.vaultId, pairing.s, await createDevice()), // consumed
      redeem(desktop.vaultId, wrong.s, await createDevice()), // never existed
    ]);
    for (const answer of answers) {
      expect(answer.status).toBe(200);
      expect(await answer.text()).toBe(JSON.stringify({ ok: false }));
    }
  });

  it("an offer TTL past the coordinator's maximum is clamped, not honoured", async () => {
    const desktop = await createDevice();
    await found(desktop);
    const now = nowSeconds();
    const { res } = await offer(desktop, desktop.vaultId, now + 86_400);
    const offered = await readJson<EnrollOfferResponse>(res);
    expect(offered.notAfter).toBeLessThanOrEqual(now + 600 + 2);
  });

  it("an unenrolled device cannot create an offer", async () => {
    const desktop = await createDevice();
    const outsider = await createDevice();
    await found(desktop);

    const pairing = await createEnrollOffer();
    const res = await SELF.fetch(ORIGIN + enrollOfferPath(desktop.vaultId), {
      method: "POST",
      headers: { ...json, ...(await outsider.auth(desktop.vaultId)) },
      body: JSON.stringify({ enrollId: pairing.enrollId, notAfter: nowSeconds() + 600 }),
    });
    expect(res.status).toBe(403);
  });

  it("the enroll route refuses a vaultId that is not self-certifying", async () => {
    const joiner = await createDevice();
    const pairing = await createEnrollOffer();
    const res = await SELF.fetch(ORIGIN + enrollPath("not-a-self-certifying-id"), {
      method: "POST",
      headers: json,
      body: JSON.stringify({ s: pairing.s, publicKey: joiner.publicKey, deviceName: "Phone" }),
    });
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("invalid-vault-id");
  });

  it("a malformed enroll body is a 400 — shape is not a secret, offers are", async () => {
    const desktop = await createDevice();
    await found(desktop);
    const res = await SELF.fetch(ORIGIN + enrollPath(desktop.vaultId), {
      method: "POST",
      headers: json,
      body: JSON.stringify({ s: "x", publicKey: "too-short", deviceName: "" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("revocation", () => {
  it("a revoked device is refused on the very next request", async () => {
    const desktop = await createDevice();
    const phone = await createDevice();
    await found(desktop);
    const { pairing } = await offer(desktop, desktop.vaultId);
    await redeem(desktop.vaultId, pairing.s, phone);
    expect((await manifest(phone, desktop.vaultId)).status).toBe(200);

    const revoked = await readJson<RevokeResponse>(
      await SELF.fetch(ORIGIN + revokePath(desktop.vaultId), {
        method: "POST",
        headers: { ...json, ...(await desktop.auth(desktop.vaultId)) },
        body: JSON.stringify({ publicKey: phone.publicKey }),
      }),
    );
    expect(revoked.ok).toBe(true);

    const after = await manifest(phone, desktop.vaultId);
    expect(after.status).toBe(403);
    expect(await after.text()).toBe("device-revoked");
  });

  it("revocation is a tombstone: a replayed offer cannot resurrect the key", async () => {
    const desktop = await createDevice();
    const phone = await createDevice();
    await found(desktop);

    const first = await offer(desktop, desktop.vaultId);
    await redeem(desktop.vaultId, first.pairing.s, phone);
    await SELF.fetch(ORIGIN + revokePath(desktop.vaultId), {
      method: "POST",
      headers: { ...json, ...(await desktop.auth(desktop.vaultId)) },
      body: JSON.stringify({ publicKey: phone.publicKey }),
    });

    // A brand-new, perfectly valid offer redeemed by the revoked key.
    const second = await offer(desktop, desktop.vaultId);
    const again = await readJson<EnrollResponse>(
      await redeem(desktop.vaultId, second.pairing.s, phone),
    );
    expect(again.ok).toBe(false);
    expect((await manifest(phone, desktop.vaultId)).status).toBe(403);

    const roster = await readJson<DeviceListResponse>(
      await SELF.fetch(ORIGIN + devicesPath(desktop.vaultId), {
        headers: await desktop.auth(desktop.vaultId),
      }),
    );
    expect(roster.devices.find((d) => d.publicKey === phone.publicKey)?.revokedAt).toBeGreaterThan(
      0,
    );
  });

  it("revoking closes every open changes stream, not just future auths", async () => {
    const desktop = await createDevice();
    const phone = await createDevice();
    await found(desktop);
    const { pairing } = await offer(desktop, desktop.vaultId);
    await redeem(desktop.vaultId, pairing.s, phone);

    const stream = await SELF.fetch(ORIGIN + changesPath(desktop.vaultId), {
      headers: await phone.auth(desktop.vaultId),
    });
    expect(stream.status).toBe(200);
    const body = stream.body;
    if (body === null) throw new Error("no SSE body");
    const reader = body.getReader();
    // The leading comment frame proves the subscription is registered.
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain(": connected");

    await SELF.fetch(ORIGIN + revokePath(desktop.vaultId), {
      method: "POST",
      headers: { ...json, ...(await desktop.auth(desktop.vaultId)) },
      body: JSON.stringify({ publicKey: phone.publicKey }),
    });

    const next = await reader.read();
    expect(next.done).toBe(true);
  });

  it("revoking a key that was never enrolled is not-found", async () => {
    const desktop = await createDevice();
    const stranger = await createDevice();
    await found(desktop);
    const result = await readJson<RevokeResponse>(
      await SELF.fetch(ORIGIN + revokePath(desktop.vaultId), {
        method: "POST",
        headers: { ...json, ...(await desktop.auth(desktop.vaultId)) },
        body: JSON.stringify({ publicKey: stranger.publicKey }),
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not-found");
    expect(result.reason).toBe("not-found");
  });
});

describe("coexistence with the account path", () => {
  it("a session bearer cannot reach the device-identity routes", async () => {
    const desktop = await createDevice();
    await found(desktop);
    const res = await SELF.fetch(ORIGIN + devicesPath(desktop.vaultId), {
      headers: { authorization: formatBearer("a-session-shaped-token") },
    });
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("missing-credential");
  });

  it("a founded vault stops accepting session-only requests", async () => {
    const desktop = await createDevice();
    await found(desktop);

    // Sign up a real account and point it at the founded vault. The Worker's
    // ownership table has no row, so it claims it — and the DO still refuses,
    // because the roster is the authority once it exists.
    const credentials = JSON.stringify({
      email: "session@example.com",
      password: "test-password-1234",
      name: "session",
    });
    await SELF.fetch(`${ORIGIN}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { ...json, origin: ORIGIN },
      body: credentials,
    });
    const signIn = await SELF.fetch(`${ORIGIN}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { ...json, origin: ORIGIN },
      body: credentials,
    });
    const token = signIn.headers.get("set-auth-token");
    if (token === null) throw new Error("no bearer token");

    const res = await SELF.fetch(ORIGIN + manifestPath(desktop.vaultId), {
      headers: { authorization: formatBearer(token) },
    });
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("device-credential-required");
  });
});
