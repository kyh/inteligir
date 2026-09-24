import { AUTH_PAGE_PATHS } from "@repo/api/cloud/account/account-schema";
import type { SignUpRequest } from "@repo/api/cloud/account/account-schema";
import { deviceLoginResponseSchema } from "@repo/api/cloud/device/device-schema";
import { z } from "zod";
import { expect } from "./assert";
import { E2E_INVITE_CODE } from "./cloud-worker";

// the account every device signs in as; the password is what login needs
export const OWNER = { email: "e2e-owner@inteligir.local", password: "e2e-password-1234" };

const sessionUserSchema = z.looseObject({ user: z.looseObject({ id: z.string() }) });

export const signUp = async (origin: string): Promise<{ bearer: string; userId: string }> => {
  const request: SignUpRequest = { name: "E2E Owner", ...OWNER, inviteCode: E2E_INVITE_CODE };
  const response = await fetch(`${origin}${AUTH_PAGE_PATHS.signUp}`, {
    body: JSON.stringify(request),
    headers: { "content-type": "application/json", origin },
    method: "POST",
  });
  expect(response.ok, `sign-up answered ${response.status}`);
  const bearer = response.headers.get("set-auth-token");
  expect(bearer !== null, "sign-up returned a session bearer");

  const session = await fetch(`${origin}/api/auth/get-session`, {
    headers: { authorization: `Bearer ${bearer}`, origin },
  });
  const parsed = sessionUserSchema.safeParse(await session.json());
  expect(parsed.success, "get-session names the signed-up user");
  return { bearer, userId: parsed.data.user.id };
};

export const loginDevice = async (
  origin: string,
  deviceName: string,
): Promise<{ deviceId: string; credential: string }> => {
  const response = await fetch(`${origin}/v1/device/login`, {
    body: JSON.stringify({ ...OWNER, deviceName }),
    headers: { "content-type": "application/json", origin },
    method: "POST",
  });
  expect(response.ok, `login answered ${response.status}`);
  return deviceLoginResponseSchema.parse(await response.json());
};

export const revokeDevice = async (
  origin: string,
  bearer: string,
  deviceId: string,
): Promise<void> => {
  const response = await fetch(`${origin}/v1/device/revoke`, {
    body: JSON.stringify({ deviceId }),
    headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json", origin },
    method: "POST",
  });
  expect(response.ok, `revoke answered ${response.status}`);
};
