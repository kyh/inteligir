import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { createSignUpAuth } from "./auth";
import { createDb } from "../db/client";
import { inviteCode } from "../db/schema";

import { allowInWindow, callerRateKey, type RateWindow } from "../rate-limit";

// The invite is claimed before the account exists: one UPDATE … WHERE redeemed_at IS NULL is
// the only atomic step, so it settles two simultaneous sign-ups on one code. A failed sign-up
// releases the claim; an isolate dying between the two burns a code, and the owner mints another.

// low: a code is short enough to guess at volume, and Better Auth's limiter never sees a rejected invite
const INVITE_WINDOW: RateWindow = { max: 10, windowMs: 60_000 };

const CODE_PATTERN = /^[A-Za-z0-9-]{6,64}$/;

// one message for "no such code" and "already used", so a caller learns only that this code will not work
const INVITE_REFUSED = "That invite code isn't valid. Check it and try again.";

function refuse(status: number, message: string): Response {
  return Response.json({ message }, { status });
}

const signUpBodySchema = z
  .looseObject({
    name: z.string().transform((value) => value.trim()),
    email: z.string().transform((value) => value.trim()),
    password: z.string().min(1),
    inviteCode: z.string().transform((value) => value.trim()),
  })
  .refine((body) => body.name !== "" && body.email !== "");

type SignUpBody = z.infer<typeof signUpBodySchema>;

export async function handleInviteSignUp(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const db = createDb(env.DB);

  if (!(await allowInWindow(env, db, callerRateKey("inviteSignUp", request), INVITE_WINDOW))) {
    // the page renders { message }; a bare-text body is the one refusal it cannot explain
    return refuse(429, "Too many attempts — wait a minute.");
  }

  const body = signUpBodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return refuse(400, "Fill in every field to create an account.");
  const parsed = body.data;
  if (!CODE_PATTERN.test(parsed.inviteCode)) return refuse(403, INVITE_REFUSED);

  const claimed = await db
    .update(inviteCode)
    .set({ redeemedBy: parsed.email, redeemedAt: new Date() })
    .where(and(eq(inviteCode.code, parsed.inviteCode), isNull(inviteCode.redeemedAt)))
    .returning()
    .get();
  if (claimed === undefined) return refuse(403, INVITE_REFUSED);

  const response = await forwardSignUp(request, env, url.origin, parsed);
  if (!response.ok) {
    // scoped to the email this request claimed with, so a loser never releases a concurrent winner's claim
    await db
      .update(inviteCode)
      .set({ redeemedBy: null, redeemedAt: null })
      .where(and(eq(inviteCode.code, parsed.inviteCode), eq(inviteCode.redeemedBy, parsed.email)));
  }
  return response;
}

// through the handler rather than auth.api.signUpEmail: a rejected sign-up is then a response to forward, not an exception to translate
function forwardSignUp(
  request: Request,
  env: Env,
  origin: string,
  body: SignUpBody,
): Promise<Response> {
  const headers = new Headers(request.headers);
  // an inherited content-length would describe the body this route consumed
  headers.delete("content-length");
  headers.set("content-type", "application/json");
  const forwarded = new Request(`${origin}/api/auth/sign-up/email`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: body.name, email: body.email, password: body.password }),
  });
  return createSignUpAuth(env, origin).handler(forwarded);
}
