// Fixtures the pairing suites share: the callback this app registers, a
// deterministic crypto, and fetches that answer the redeem either way. Nothing
// here touches a network or a native module.

import { createRequire } from "node:module";
import {
  PAIR_APPROVE_PARAMS,
  PAIR_MOBILE_REDIRECT_SEGMENT,
  type PkceCrypto,
} from "@repo/api/cloud/pairing/pairing-schema";
import { z } from "zod";
import type { CloudFetch } from "@repo/api/cloud/client";

/**
 * The scheme THIS APP registers, read from its own config — what
 * `Linking.createURL` composes the callback under in a standalone build. The
 * config is plain JS (its own header says why), so a node test can load it.
 */
const configFactorySchema = z.custom<(context: { config: object }) => object>(
  (value) => value instanceof Function,
  "app.config.js no longer exports a config factory",
);

function registeredScheme(): string {
  const factory = configFactorySchema.parse(
    createRequire(import.meta.url)("../../../app.config.js"),
  );
  return z.looseObject({ scheme: z.string() }).parse(factory({ config: {} })).scheme;
}

export const CALLBACK = `${registeredScheme()}://${PAIR_MOBILE_REDIRECT_SEGMENT}`;
export const REDEEMED = { deviceId: "dev_x", credential: `igd_${"c".repeat(64)}` };

export const fakeCrypto: PkceCrypto = {
  randomBytes: (length) => Uint8Array.from({ length }, (_unused, index) => (index * 7 + 1) & 0xff),
  sha256: (input) => Promise.resolve(new TextEncoder().encode(input.slice(0, 32).padEnd(32, "x"))),
};

/** A fetch that answers the redeem with a durable credential. */
export const redeemOk: CloudFetch = () =>
  Promise.resolve(
    new Response(JSON.stringify(REDEEMED), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );

/** A fetch that refuses the redeem with the contract's error envelope. */
export const redeemRefused: CloudFetch = () =>
  Promise.resolve(
    new Response(
      JSON.stringify({ error: { code: "code-expired", message: "that code expired" } }),
      {
        status: 400,
        headers: { "content-type": "application/json" },
      },
    ),
  );

/** The `state` an approve URL carries — what the approve page echoes back. */
export function stateOf(approveUrl: string): string {
  return new URL(approveUrl).searchParams.get(PAIR_APPROVE_PARAMS.state) ?? "";
}
