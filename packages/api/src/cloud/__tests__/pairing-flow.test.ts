import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { CloudFetch } from "../cloud-client";
import {
  createPairingFlow,
  normalizeDeviceName,
  PENDING_PAIR_TTL_MS,
  type PairingFlow,
} from "../pairing/pairing-flow";
import {
  DEVICE_NAME_MAX_LENGTH,
  PAIR_APPROVE_PARAMS,
  PAIR_STATE_PATTERN,
  PKCE_S256_PATTERN,
  pkceChallengeS256,
  redeemDeviceRequestSchema,
} from "../pairing/pairing-schema";

const CLOUD_URL = "https://cloud.test";
const REDIRECT = "http://127.0.0.1:4664/pair/callback";
const REDEEMED = { deviceId: "dev_x", credential: `igd_${"c".repeat(64)}` };

interface RecordedRedeem {
  url: string;
  body: string;
}

function redeemOk() {
  const calls: RecordedRedeem[] = [];
  const fetch: CloudFetch = (input, init) => {
    calls.push({ url: input, body: z.string().parse(init?.body) });
    return Promise.resolve(Response.json(REDEEMED));
  };
  return { fetch, calls };
}

const redeemRefused: CloudFetch = () =>
  Promise.resolve(
    Response.json(
      { error: { code: "code-expired", message: "that code expired" } },
      { status: 410 },
    ),
  );

function stateOf(approveUrl: string): string {
  return new URL(approveUrl).searchParams.get(PAIR_APPROVE_PARAMS.state) ?? "";
}

function flowWith(fetch: CloudFetch, now?: () => number): PairingFlow {
  const args: Parameters<typeof createPairingFlow>[0] = { cloudUrl: CLOUD_URL, fetch };
  if (now !== undefined) args.now = now;
  return createPairingFlow(args);
}

describe("normalizeDeviceName", () => {
  it("trims, bounds to the cloud's ceiling, and defaults an empty name", () => {
    expect(normalizeDeviceName("  Kaiyu's MacBook ")).toBe("Kaiyu's MacBook");
    expect(normalizeDeviceName("x".repeat(200))).toBe("x".repeat(DEVICE_NAME_MAX_LENGTH));
    expect(normalizeDeviceName("   ")).toBe("this device");
  });
});

describe("begin", () => {
  it("composes the approve URL with the redirect, a fresh state, the name and the S256 challenge", async () => {
    const flow = flowWith(redeemOk().fetch);
    const begun = await flow.begin({ redirect: REDIRECT, deviceName: " Test Laptop " });
    const url = new URL(begun.url);
    expect(url.origin).toBe(CLOUD_URL);
    expect(url.searchParams.get(PAIR_APPROVE_PARAMS.redirect)).toBe(REDIRECT);
    expect(url.searchParams.get(PAIR_APPROVE_PARAMS.name)).toBe("Test Laptop");
    expect(url.searchParams.get(PAIR_APPROVE_PARAMS.state)).toMatch(PAIR_STATE_PATTERN);
    expect(url.searchParams.get(PAIR_APPROVE_PARAMS.challenge)).toMatch(PKCE_S256_PATTERN);
    expect(begun.deviceName).toBe("Test Laptop");
    expect(begun.expiresInMs).toBe(PENDING_PAIR_TTL_MS);
  });
});

describe("complete", () => {
  it("redeems on the matching state with the verifier the challenge was hashed from", async () => {
    const redeem = redeemOk();
    const flow = flowWith(redeem.fetch);
    const begun = await flow.begin({ redirect: REDIRECT, deviceName: "Laptop" });
    const completion = await flow.complete({ code: "ABCD-EFGH", state: stateOf(begun.url) });
    expect(completion).toStrictEqual({ kind: "paired", credential: REDEEMED });

    expect(redeem.calls).toHaveLength(1);
    const body = redeemDeviceRequestSchema.parse(JSON.parse(redeem.calls[0]?.body ?? ""));
    expect(body.deviceName).toBe("Laptop");
    expect(await pkceChallengeS256(body.verifier)).toBe(
      new URL(begun.url).searchParams.get(PAIR_APPROVE_PARAMS.challenge),
    );
  });

  it("consumes the state BEFORE the redeem, so a replay finds nothing armed", async () => {
    const redeem = redeemOk();
    const flow = flowWith(redeem.fetch);
    const begun = await flow.begin({ redirect: REDIRECT, deviceName: "Laptop" });
    const state = stateOf(begun.url);
    expect((await flow.complete({ code: "ABCD-EFGH", state })).kind).toBe("paired");

    expect(await flow.complete({ code: "ABCD-EFGH", state })).toStrictEqual({
      kind: "no-pending",
    });
    expect(redeem.calls).toHaveLength(1);
  });

  it("refuses a wrong state WITHOUT consuming the approval, and without a redeem", async () => {
    const redeem = redeemOk();
    const flow = flowWith(redeem.fetch);
    const begun = await flow.begin({ redirect: REDIRECT, deviceName: "Laptop" });
    expect(await flow.complete({ code: "ABCD-EFGH", state: "0".repeat(32) })).toStrictEqual({
      kind: "state-mismatch",
    });
    expect(redeem.calls).toHaveLength(0);

    expect((await flow.complete({ code: "ABCD-EFGH", state: stateOf(begun.url) })).kind).toBe(
      "paired",
    );
  });

  it("expires an approval that sat too long, consuming it", async () => {
    let nowValue = 1_000;
    const redeem = redeemOk();
    const flow = flowWith(redeem.fetch, () => nowValue);
    const begun = await flow.begin({ redirect: REDIRECT, deviceName: "Laptop" });
    const state = stateOf(begun.url);
    nowValue += PENDING_PAIR_TTL_MS + 1;
    expect(await flow.complete({ code: "ABCD-EFGH", state })).toStrictEqual({ kind: "expired" });
    expect(redeem.calls).toHaveLength(0);
    expect(await flow.complete({ code: "ABCD-EFGH", state })).toStrictEqual({
      kind: "no-pending",
    });
  });

  it("keeps ONE slot: a second begin is the button pressed again", async () => {
    const flow = flowWith(redeemOk().fetch);
    const first = await flow.begin({ redirect: REDIRECT, deviceName: "Laptop" });
    const second = await flow.begin({ redirect: REDIRECT, deviceName: "Laptop" });
    expect(stateOf(first.url)).not.toBe(stateOf(second.url));
    expect(await flow.complete({ code: "ABCD-EFGH", state: stateOf(first.url) })).toStrictEqual({
      kind: "state-mismatch",
    });
    expect((await flow.complete({ code: "ABCD-EFGH", state: stateOf(second.url) })).kind).toBe(
      "paired",
    );
  });

  it("surfaces the cloud's refusal as a value the caller can render", async () => {
    const flow = flowWith(redeemRefused);
    const begun = await flow.begin({ redirect: REDIRECT, deviceName: "Laptop" });
    const completion = await flow.complete({ code: "ABCD-EFGH", state: stateOf(begun.url) });
    expect(completion).toStrictEqual({
      kind: "refused",
      failure: {
        kind: "refused",
        code: "code-expired",
        message: "that code expired",
        deviceSeq: null,
      },
    });
  });

  it("is inert after cancel — nothing was completable", async () => {
    const redeem = redeemOk();
    const flow = flowWith(redeem.fetch);
    const begun = await flow.begin({ redirect: REDIRECT, deviceName: "Laptop" });
    flow.cancel();
    expect(await flow.complete({ code: "ABCD-EFGH", state: stateOf(begun.url) })).toStrictEqual({
      kind: "no-pending",
    });
    expect(redeem.calls).toHaveLength(0);
  });
});
