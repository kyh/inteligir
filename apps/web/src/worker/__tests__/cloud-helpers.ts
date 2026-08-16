import {
  mintPairingCodeResponseSchema,
  redeemDeviceResponseSchema,
} from "@repo/cloud-contract/pairing";
import { env, SELF } from "cloudflare:test";
import { expect } from "vitest";
import { createDb } from "../db/client";
import { inviteCode } from "../db/schema";

// Shared setup for the cloud suites: a real account through the invite gate,
// a real device through the pairing flow — every step is the production path.

export const ORIGIN = "https://inteligir-web.workers.dev";
const PASSWORD = "test-password-1234";

let inviteCounter = 0;

/** Create an account and hand back its session BEARER (what a native caller
 * holds; the browser's cookie is the same session). */
export async function signUpUser(email: string): Promise<{ bearer: string; password: string }> {
  const code = `CLOUD-TEST-${++inviteCounter}`;
  await createDb(env.DB).insert(inviteCode).values({ code });
  const response = await SELF.fetch(`${ORIGIN}/v1/auth/sign-up`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ name: "Cloud Tester", email, password: PASSWORD, inviteCode: code }),
  });
  expect(response.status).toBe(200);
  const bearer = response.headers.get("set-auth-token");
  expect(bearer).not.toBeNull();
  return { bearer: bearer ?? "", password: PASSWORD };
}

export function sessionHeaders(bearer: string): Record<string, string> {
  return { authorization: `Bearer ${bearer}`, origin: ORIGIN };
}

export async function mintCode(bearer: string): Promise<string> {
  const response = await SELF.fetch(`${ORIGIN}/v1/device/code`, {
    method: "POST",
    headers: sessionHeaders(bearer),
  });
  expect(response.status).toBe(200);
  return mintPairingCodeResponseSchema.parse(await response.json()).code;
}

export async function pairDevice(
  bearer: string,
  deviceName: string,
): Promise<{ deviceId: string; credential: string }> {
  const code = await mintCode(bearer);
  const response = await SELF.fetch(`${ORIGIN}/v1/device/redeem`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, deviceName }),
  });
  expect(response.status).toBe(200);
  return redeemDeviceResponseSchema.parse(await response.json());
}

export function deviceHeaders(credential: string): Record<string, string> {
  return { authorization: `Bearer ${credential}` };
}
