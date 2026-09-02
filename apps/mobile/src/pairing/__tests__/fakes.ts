import { createRequire } from "node:module";
import {
  PAIR_APPROVE_PARAMS,
  PAIR_MOBILE_REDIRECT_SEGMENT,
  type PkceCrypto,
} from "@repo/api/cloud/pairing/pairing-schema";
import { z } from "zod";
import type { CloudFetch } from "@repo/api/cloud/client";

// the scheme is read from app.config.js itself, so a rename fails here rather than on a phone.
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

export const redeemOk: CloudFetch = () =>
  Promise.resolve(
    new Response(JSON.stringify(REDEEMED), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );

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

export function stateOf(approveUrl: string): string {
  return new URL(approveUrl).searchParams.get(PAIR_APPROVE_PARAMS.state) ?? "";
}
