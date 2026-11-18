// Every sign-up's one door, `POST /api/sign-up`, the site's page and the phone's alike. The invite is
// claimed before the account exists (./invite-codes.ts), and a failed sign-up releases the claim; a
// function dying between the two burns a code, and the owner mints another.

import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  signUpRequestSchema,
} from "@repo/contract/account/account-schema";
import type { SignUpRequest } from "@repo/contract/account/account-schema";
import type { z } from "zod";

import { spendCallerBudget } from "../rate-limit";
import { getSignUpAuth, withoutAuthToken } from "./auth";
import { claimInvite, releaseInvite } from "./invite-codes";

// one sentence for "no such code" and "already used", so a caller learns only that it will not work
const INVITE_REFUSED = "That invite code doesn't work.";

// refused before the claim, so a password Better Auth would refuse never claims and releases a code
const signUpBodyRefusal = (error: z.ZodError): string =>
  error.issues.every((issue) => issue.path[0] === "password")
    ? `Use a password of ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters.`
    : "Fill in every field to create an account.";

// the page and the phone render { message }; a bare-text body is the one refusal they cannot explain
const formRefusal = (status: number, message: string): Response =>
  Response.json({ message }, { status });

// through the handler rather than auth.api.signUpEmail: a refused sign-up is then a response to
// forward, not an exception to translate, and the browser keeps the cookie it sets
const forwardSignUp = async (request: Request, body: SignUpRequest): Promise<Response> => {
  const headers = new Headers(request.headers);
  // an inherited content-length would describe the body this route consumed
  headers.delete("content-length");
  headers.set("content-type", "application/json");
  const forwarded = new Request(new URL("/api/auth/sign-up/email", request.url), {
    body: JSON.stringify({ email: body.email, name: body.name, password: body.password }),
    headers,
    method: "POST",
  });
  return withoutAuthToken(await getSignUpAuth().handler(forwarded));
};

export const handleInviteSignUp = async (request: Request): Promise<Response> => {
  const spent = await spendCallerBudget("inviteSignUp", request);
  if (spent.kind === "refused") {
    return formRefusal(429, "Too many attempts — wait a minute.");
  }

  const body = signUpRequestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return formRefusal(400, signUpBodyRefusal(body.error));
  }
  const parsed = body.data;
  if (!(await claimInvite(parsed.inviteCode, parsed.email))) {
    return formRefusal(403, INVITE_REFUSED);
  }

  const response = await forwardSignUp(request, parsed);
  if (!response.ok) {
    await releaseInvite(parsed.inviteCode, parsed.email);
  }
  return response;
};
