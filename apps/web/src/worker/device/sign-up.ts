import type { DeviceSignUpRequest } from "@repo/contract/cloud/account/account-schema";
import type { DeviceLoginResponse } from "@repo/contract/cloud/device/device-schema";
import { APIError } from "better-auth/api";
import { z } from "zod";
import type { createSignUpAuth } from "../auth/auth";
import { claimInvite, releaseInvite } from "../auth/invite";
import type { Db } from "../db/client";
import { mintDeviceCredential } from "./login";

// The app's door to the invite gate: the site's claim, the account through the one Better Auth
// instance allowed to create one, then this device's credential, so the person who just made the
// account never types the password a second time.

type SignUpAuth = ReturnType<typeof createSignUpAuth>;

type SignUpFailure = "invite-refused" | "account-exists";

export type SignUpResult =
  | { readonly signedUp: true; readonly response: DeviceLoginResponse }
  | { readonly signedUp: false; readonly failure: SignUpFailure };

const apiErrorBodySchema = z.object({ code: z.string() });

// Better Auth's one refusal of this account: the request's schema holds the same bounds, so
// anything else it raises is a store's fault, which the route answers as internal
const isAccountExists = (error: APIError): boolean => {
  const body = apiErrorBodySchema.safeParse(error.body);
  // USER_ALREADY_EXISTS, and the _USE_ANOTHER_EMAIL spelling signUpEmail raises today
  return (
    error.statusCode === 422 && body.success && body.data.code.startsWith("USER_ALREADY_EXISTS")
  );
};

export const signUpDevice = async (
  db: Db,
  auth: SignUpAuth,
  args: DeviceSignUpRequest,
): Promise<SignUpResult> => {
  if (!(await claimInvite(db, args.inviteCode, args.email))) {
    return { failure: "invite-refused", signedUp: false };
  }
  let signedUp: { token: string | null; user: { id: string; email: string } };
  try {
    signedUp = await auth.api.signUpEmail({
      body: { email: args.email, name: args.name, password: args.password },
    });
  } catch (error) {
    // no account came of it, so the code goes back whatever the reason
    await releaseInvite(db, args.inviteCode, args.email);
    if (error instanceof APIError && isAccountExists(error)) {
      return { failure: "account-exists", signedUp: false };
    }
    throw error;
  }
  const minted = await mintDeviceCredential(db, {
    deviceName: args.deviceName,
    sessionToken: signedUp.token,
    user: signedUp.user,
  });
  if (minted === null) {
    // unreachable while the cap is above zero: an account made a moment ago holds no device
    throw new Error("a new account's first device was refused a slot");
  }
  return { response: minted, signedUp: true };
};
