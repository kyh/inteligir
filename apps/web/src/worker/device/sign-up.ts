import type { DeviceSignUpRequest } from "@repo/api/cloud/account/account-schema";
import type { DeviceLoginResponse } from "@repo/api/cloud/device/device-schema";
import { APIError } from "better-auth/api";
import { z } from "zod";
import type { createSignUpAuth } from "../auth/auth";
import { claimInvite, INVITE_REFUSED, releaseInvite } from "../auth/invite";
import type { createDb } from "../db/client";
import { mintDeviceCredential } from "./login";

// The app's door to the invite gate: the site's claim, the account through the one Better Auth
// instance allowed to create one, then this device's credential, so the person who just made the
// account never types the password a second time.

type Db = ReturnType<typeof createDb>;
type SignUpAuth = ReturnType<typeof createSignUpAuth>;

type SignUpFailure = "invite-refused" | "account-exists" | "bad-request";

export type SignUpResult =
  | { readonly signedUp: true; readonly response: DeviceLoginResponse }
  | { readonly signedUp: false; readonly failure: SignUpFailure; readonly message: string };

const refuseSignUp = (failure: SignUpFailure, message: string): SignUpResult => ({
  failure,
  message,
  signedUp: false,
});

const apiErrorBodySchema = z.object({ code: z.string() });

// Better Auth's refusal of this account, or null for a fault the route answers as internal
const refusalOf = (error: APIError): SignUpResult | null => {
  const body = apiErrorBodySchema.safeParse(error.body);
  // USER_ALREADY_EXISTS, and the _USE_ANOTHER_EMAIL spelling signUpEmail raises today
  if (
    error.statusCode === 422 &&
    body.success &&
    body.data.code.startsWith("USER_ALREADY_EXISTS")
  ) {
    return refuseSignUp(
      "account-exists",
      "An account with this email already exists. Sign in instead.",
    );
  }
  if (error.statusCode === 400) {
    return refuseSignUp("bad-request", error.message);
  }
  return null;
};

export const signUpDevice = async (
  db: Db,
  d1: D1Database,
  auth: SignUpAuth,
  args: DeviceSignUpRequest,
): Promise<SignUpResult> => {
  if (!(await claimInvite(db, args.inviteCode, args.email))) {
    return refuseSignUp("invite-refused", INVITE_REFUSED);
  }
  let signedUp: { token: string | null; user: { id: string } };
  try {
    signedUp = await auth.api.signUpEmail({
      body: { email: args.email, name: args.name, password: args.password },
    });
  } catch (error) {
    // no account came of it, so the code goes back whatever the reason
    await releaseInvite(db, args.inviteCode, args.email);
    const refusal = error instanceof APIError ? refusalOf(error) : null;
    if (refusal === null) {
      throw error;
    }
    return refusal;
  }
  const minted = await mintDeviceCredential(db, d1, {
    deviceName: args.deviceName,
    sessionToken: signedUp.token,
    userId: signedUp.user.id,
  });
  if (minted === null) {
    // unreachable while the cap is above zero: an account made a moment ago holds no device
    throw new Error("a new account's first device was refused a slot");
  }
  return { response: minted, signedUp: true };
};
