import {
  PAIR_APPROVE_PARAMS,
  PAIR_STATE_PATTERN,
  pairRedirectUrlSchema,
  PKCE_S256_PATTERN,
} from "@repo/api/cloud/pairing/pairing-schema";
import { describe, expect, it } from "vitest";
import { createPairingManager } from "../pairing-manager";
import { CALLBACK, fakeCrypto, REDEEMED, redeemOk, redeemRefused, stateOf } from "./fakes";

describe("the pairing manager", () => {
  it("aims at a callback the production approve page admits", () => {
    // The cross-package lockstep that makes this flow real: CALLBACK is
    // COMPOSED the way the app composes it — the registered scheme from
    // app.config.js plus the contract's own segment (what expo-pairing hands
    // `Linking.createURL`) — and must pass the contract's redirect allowlist,
    // or production refuses the pairing at parse. A scheme rename or a
    // segment edit on either side fails here, not on a user's phone.
    expect(pairRedirectUrlSchema.safeParse(CALLBACK).success).toBe(true);
  });

  it("mints an approve URL carrying the callback, a state, and the S256 challenge", async () => {
    const manager = createPairingManager({
      cloudUrl: "https://cloud.test",
      callbackUrl: CALLBACK,
      crypto: fakeCrypto,
      deviceName: "Test Phone",
    });
    const url = new URL(await manager.beginPair());
    expect(url.searchParams.get(PAIR_APPROVE_PARAMS.redirect)).toBe(CALLBACK);
    expect(url.searchParams.get(PAIR_APPROVE_PARAMS.name)).toBe("Test Phone");
    expect(url.searchParams.get(PAIR_APPROVE_PARAMS.state)).toMatch(PAIR_STATE_PATTERN);
    expect(url.searchParams.get(PAIR_APPROVE_PARAMS.challenge)).toMatch(PKCE_S256_PATTERN);
  });

  it("redeems on the matching state and hands back the credential", async () => {
    const manager = createPairingManager({
      cloudUrl: "https://cloud.test",
      callbackUrl: CALLBACK,
      crypto: fakeCrypto,
      deviceName: "Test Phone",
      fetch: redeemOk,
    });
    const state = stateOf(await manager.beginPair());
    const completion = await manager.completePair({ code: "ABCD-EFGH", state });
    expect(completion).toStrictEqual({ kind: "paired", credential: REDEEMED });
    // Consumed before the redeem — a replay finds nothing armed.
    expect(await manager.completePair({ code: "ABCD-EFGH", state })).toStrictEqual({
      kind: "no-pending",
    });
  });

  it("refuses a wrong state WITHOUT consuming the pending approval", async () => {
    const manager = createPairingManager({
      cloudUrl: "https://cloud.test",
      callbackUrl: CALLBACK,
      crypto: fakeCrypto,
      deviceName: "Test Phone",
      fetch: redeemOk,
    });
    const state = stateOf(await manager.beginPair());
    expect(
      await manager.completePair({ code: "ABCD-EFGH", state: "00000000000000000000000000000000" }),
    ).toStrictEqual({
      kind: "state-mismatch",
    });
    // Still armed: a wrong state is someone else's traffic, not a cancel — the
    // real approval completes after it.
    expect(await manager.completePair({ code: "ABCD-EFGH", state })).toStrictEqual({
      kind: "paired",
      credential: REDEEMED,
    });
  });

  it("expires an approval that sat too long", async () => {
    let nowValue = 1000;
    const manager = createPairingManager({
      cloudUrl: "https://cloud.test",
      callbackUrl: CALLBACK,
      crypto: fakeCrypto,
      deviceName: "Test Phone",
      fetch: redeemOk,
      now: () => nowValue,
    });
    const state = stateOf(await manager.beginPair());
    nowValue += 11 * 60_000;
    expect(await manager.completePair({ code: "ABCD-EFGH", state })).toStrictEqual({
      kind: "expired",
    });
  });

  it("surfaces a cloud refusal as a refused completion", async () => {
    const manager = createPairingManager({
      cloudUrl: "https://cloud.test",
      callbackUrl: CALLBACK,
      crypto: fakeCrypto,
      deviceName: "Test Phone",
      fetch: redeemRefused,
    });
    const state = stateOf(await manager.beginPair());
    const completion = await manager.completePair({ code: "ABCD-EFGH", state });
    expect(completion.kind).toBe("refused");
  });
});
