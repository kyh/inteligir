import { AUTH_PAGE_PATHS } from "@repo/contract/cloud/account/account-schema";
import type { SignUpRequest } from "@repo/contract/cloud/account/account-schema";
import { deviceLoginResponseSchema } from "@repo/contract/cloud/device/device-schema";
import { z } from "zod";
import { expect } from "./assert";
import { E2E_INVITE_CODE } from "./cloud-worker";
import type { AppInstance, InstanceApi } from "./instance";
import { pollUntil } from "./poll";

const IDENTITY_DEADLINE_MS = 15_000;
const POLL_INTERVAL_MS = 200;

// the account every device signs in as; the password is what login needs
export const OWNER = { email: "e2e-owner@inteligir.local", password: "e2e-password-1234" };

// the device name a scenario's phone signs in as
export const PHONE_NAME = "E2E Phone";

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

// the account identity lands asynchronously after the login, and the cross-account fence fails closed
// until it does; named by email, so a device signed in as another account never passes.
export const untilIdentityKnown = async (api: InstanceApi, label: string): Promise<void> => {
  await pollUntil(
    async () => await api.cloud.status(),
    (status) => status.state === "signed-in" && status.accountEmail === OWNER.email,
    {
      deadlineMs: IDENTITY_DEADLINE_MS,
      describe: (status) =>
        `${label} never answered signed in as ${OWNER.email} within ${IDENTITY_DEADLINE_MS}ms: ${JSON.stringify(status)}`,
      intervalMs: POLL_INTERVAL_MS,
    },
  );
};

export const signInOwner = async (
  app: AppInstance,
  label: string,
  deviceName: string,
): Promise<void> => {
  const signedIn = await app.api.cloud.login({ ...OWNER, deviceName });
  expect(signedIn.state === "signed-in", `${label}'s login answered ${signedIn.state}`);
  await untilIdentityKnown(app.api, label);
};
