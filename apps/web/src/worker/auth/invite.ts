import { signUpRequestSchema } from "@repo/api/cloud/account/account-schema";
import type { SignUpRequest } from "@repo/api/cloud/account/account-schema";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@repo/api/cloud/device/device-schema";
import { and, eq, isNull } from "drizzle-orm";
import type { z } from "zod";
import { createSignUpAuth } from "./auth";
import { createDb } from "../db/client";
import { inviteCode } from "../db/schema";

import { spendCallerBudget } from "../rate-limit";

// The invite is claimed before the account exists: one UPDATE … WHERE redeemed_at IS NULL is
// the only atomic step, so it settles two simultaneous sign-ups on one code. A failed sign-up
// releases the claim; an isolate dying between the two burns a code, and the owner mints another.

const CODE_PATTERN = /^[A-Za-z0-9-]{6,64}$/u;

// one message for "no such code" and "already used", so a caller learns only that this code will not work
const INVITE_REFUSED = "That invite code isn't valid. Check it and try again.";

const refuse = (status: number, message: string): Response =>
  Response.json({ message }, { status });

// refused before the claim, so a password Better Auth would refuse never claims and releases a code
const bodyRefusal = (error: z.ZodError): string =>
  error.issues.every((issue) => issue.path[0] === "password")
    ? `Use a password of ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters.`
    : "Fill in every field to create an account.";

// through the handler rather than auth.api.signUpEmail: a rejected sign-up is then a response to forward, not an exception to translate
const forwardSignUp = async (
  request: Request,
  env: Env,
  origin: string,
  body: SignUpRequest,
): Promise<Response> => {
  const headers = new Headers(request.headers);
  // an inherited content-length would describe the body this route consumed
  headers.delete("content-length");
  headers.set("content-type", "application/json");
  const forwarded = new Request(`${origin}/api/auth/sign-up/email`, {
    body: JSON.stringify({ email: body.email, name: body.name, password: body.password }),
    headers,
    method: "POST",
  });
  return await createSignUpAuth(env, origin).handler(forwarded);
};

export const handleInviteSignUp = async (request: Request, env: Env): Promise<Response> => {
  const url = new URL(request.url);
  const db = createDb(env.DB);

  if (!(await spendCallerBudget(env, db, "inviteSignUp", request))) {
    // the page renders { message }; a bare-text body is the one refusal it cannot explain
    return refuse(429, "Too many attempts — wait a minute.");
  }

  const body = signUpRequestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return refuse(400, bodyRefusal(body.error));
  }
  const parsed = body.data;
  if (!CODE_PATTERN.test(parsed.inviteCode)) {
    return refuse(403, INVITE_REFUSED);
  }

  const claimed = await db
    .update(inviteCode)
    .set({ redeemedAt: new Date(), redeemedBy: parsed.email })
    .where(and(eq(inviteCode.code, parsed.inviteCode), isNull(inviteCode.redeemedAt)))
    .returning()
    .get();
  if (claimed === undefined) {
    return refuse(403, INVITE_REFUSED);
  }

  const response = await forwardSignUp(request, env, url.origin, parsed);
  if (!response.ok) {
    // scoped to the email this request claimed with, so a loser never releases a concurrent winner's claim
    await db
      .update(inviteCode)
      .set({ redeemedAt: null, redeemedBy: null })
      .where(and(eq(inviteCode.code, parsed.inviteCode), eq(inviteCode.redeemedBy, parsed.email)));
  }
  return response;
};
