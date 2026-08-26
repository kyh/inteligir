import {
  PAIR_APPROVE_PARAMS,
  PAIR_STATE_PATTERN,
  PKCE_S256_PATTERN,
} from "@repo/api/cloud/pairing/pairing-schema";
import { describe, expect, it } from "vitest";
import type { CloudFetch } from "@repo/api/cloud/client";
import { createPairingManager } from "../pairing-manager";
import type { PkceCrypto } from "../pkce";

const CALLBACK = "inteligir://pair/callback";
const REDEEMED = { deviceId: "dev_x", credential: `igd_${"c".repeat(64)}` };

const fakeCrypto: PkceCrypto = {
  randomBytes: (length) => Uint8Array.from({ length }, (_unused, index) => (index * 7 + 1) & 0xff),
  sha256: (input) => Promise.resolve(new TextEncoder().encode(input.slice(0, 32).padEnd(32, "x"))),
};

/** A fetch that answers the redeem with a durable credential. */
const redeemOk: CloudFetch = () =>
  Promise.resolve(
    new Response(JSON.stringify(REDEEMED), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );

/** A fetch that refuses the redeem with the contract's error envelope. */
const redeemRefused: CloudFetch = () =>
  Promise.resolve(
    new Response(
      JSON.stringify({ error: { code: "code-expired", message: "that code expired" } }),
      {
        status: 400,
        headers: { "content-type": "application/json" },
      },
    ),
  );

function stateOf(approveUrl: string): string {
  return new URL(approveUrl).searchParams.get(PAIR_APPROVE_PARAMS.state) ?? "";
}

describe("the pairing manager", () => {
  it("mints an approve URL carrying the callback, a state, and the S256 challenge", async () => {
    const manager = createPairingManager({
      cloudUrl: "https://cloud.test",
      callbackUrl: CALLBACK,
      crypto: fakeCrypto,
      defaultDeviceName: "Test Phone",
    });
    const begun = await manager.beginPair();
    const url = new URL(begun.approveUrl);
    expect(url.searchParams.get(PAIR_APPROVE_PARAMS.redirect)).toBe(CALLBACK);
    expect(url.searchParams.get(PAIR_APPROVE_PARAMS.name)).toBe("Test Phone");
    expect(url.searchParams.get(PAIR_APPROVE_PARAMS.state)).toMatch(PAIR_STATE_PATTERN);
    expect(url.searchParams.get(PAIR_APPROVE_PARAMS.challenge)).toMatch(PKCE_S256_PATTERN);
    expect(manager.isPending()).toBe(true);
  });

  it("redeems on the matching state and hands back the credential", async () => {
    const manager = createPairingManager({
      cloudUrl: "https://cloud.test",
      callbackUrl: CALLBACK,
      crypto: fakeCrypto,
      defaultDeviceName: "Test Phone",
      fetch: redeemOk,
    });
    const begun = await manager.beginPair();
    const completion = await manager.completePair({
      code: "ABCD-EFGH",
      state: stateOf(begun.approveUrl),
    });
    expect(completion).toStrictEqual({ kind: "paired", credential: REDEEMED });
    // Consumed before the redeem — a replay finds nothing armed.
    expect(manager.isPending()).toBe(false);
    expect(
      await manager.completePair({ code: "ABCD-EFGH", state: stateOf(begun.approveUrl) }),
    ).toStrictEqual({
      kind: "no-pending",
    });
  });

  it("refuses a wrong state WITHOUT consuming the pending approval", async () => {
    const manager = createPairingManager({
      cloudUrl: "https://cloud.test",
      callbackUrl: CALLBACK,
      crypto: fakeCrypto,
      defaultDeviceName: "Test Phone",
      fetch: redeemOk,
    });
    await manager.beginPair();
    expect(
      await manager.completePair({ code: "ABCD-EFGH", state: "00000000000000000000000000000000" }),
    ).toStrictEqual({
      kind: "state-mismatch",
    });
    // Still armed: a wrong state is someone else's traffic, not a cancel.
    expect(manager.isPending()).toBe(true);
  });

  it("expires an approval that sat too long", async () => {
    let nowValue = 1000;
    const manager = createPairingManager({
      cloudUrl: "https://cloud.test",
      callbackUrl: CALLBACK,
      crypto: fakeCrypto,
      defaultDeviceName: "Test Phone",
      fetch: redeemOk,
      now: () => nowValue,
    });
    const begun = await manager.beginPair();
    nowValue += 11 * 60_000;
    expect(
      await manager.completePair({ code: "ABCD-EFGH", state: stateOf(begun.approveUrl) }),
    ).toStrictEqual({
      kind: "expired",
    });
  });

  it("surfaces a cloud refusal as a refused completion", async () => {
    const manager = createPairingManager({
      cloudUrl: "https://cloud.test",
      callbackUrl: CALLBACK,
      crypto: fakeCrypto,
      defaultDeviceName: "Test Phone",
      fetch: redeemRefused,
    });
    const begun = await manager.beginPair();
    const completion = await manager.completePair({
      code: "ABCD-EFGH",
      state: stateOf(begun.approveUrl),
    });
    expect(completion.kind).toBe("refused");
  });
});
