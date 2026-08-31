import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { createSignUpAuth } from "./auth";
import { createDb } from "../db/client";
import { inviteCode } from "../db/schema";

import { allowInWindow, callerIp, type RateWindow } from "../rate-limit";

// ---------------------------------------------------------------------------
// `POST /v1/auth/sign-up` — the only way an account is created on this
// deployment. Body is Better Auth's sign-up body plus one field:
// `{ name, email, password, inviteCode }`.
//
// Better Auth's own `/api/auth/sign-up/email` REFUSES. The instance every
// other caller builds carries `disableSignUp`, which Better Auth checks off the
// options its sign-up endpoint runs under — so the flag shuts `auth.api
// .signUpEmail` and every other way into that endpoint, not only the HTTP path.
// This route claims an invite and then FORWARDS into the one instance built
// with sign-up enabled (`createSignUpAuth`), so the response — `set-cookie`,
// `set-auth-token`, and every validation error — is Better Auth's own,
// untouched. An account cannot be created without spending a code.
//
// ORDER MATTERS. The invite is claimed BEFORE the account exists, because the
// claim is the only atomic step available: one `UPDATE … WHERE code = ? AND
// redeemed_at IS NULL` settles two simultaneous sign-ups on one code. A
// failed sign-up releases the claim. The residual is honest — an isolate that
// dies between the claim and the release burns a code — and the fix is to mint
// another one, which costs the owner a single SQL statement.
// ---------------------------------------------------------------------------

/** Invite attempts per IP. Low, because a code is short enough to guess at
 * volume and nothing else bounds it. Better Auth's own limiter never sees a
 * rejected invite: the forward that would trip it does not happen. */
const INVITE_WINDOW: RateWindow = { max: 10, windowMs: 60_000 };
const INVITE_RATE_KEY_PREFIX = "invite-signup:";

/** The grammar a code must fit before it reaches the database — a typed
 * string from an email, so no separators, no whitespace, no case folding
 * (codes are compared exactly, and the owner mints them as they are). */
const CODE_PATTERN = /^[A-Za-z0-9-]{6,64}$/;

/** What the sign-up page says when the code is the problem. Deliberately one
 * message for "no such code" and "already used": a caller who is not the owner
 * learns only that this code will not work. */
const INVITE_REFUSED = "That invite code isn't valid. Check it and try again.";

/** Better Auth's own error envelope, so the sign-up page renders a refusal
 * from this route and one from Better Auth through the same code path. */
function refuse(status: number, message: string): Response {
  return Response.json({ message }, { status });
}

/** The request body, or a refusal when it is not a sign-up at all. Field
 * CONTENT (email shape, password length) is Better Auth's to judge — this only
 * proves the four strings are present so the claim is not made for a request
 * that could never have succeeded. Loose, because Better Auth's own sign-up
 * body may carry more than the fields forwarded below. */
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

  const inviteKey = `${INVITE_RATE_KEY_PREFIX}${callerIp(request)}`;
  if (!(await allowInWindow(env, db, inviteKey, Date.now(), INVITE_WINDOW))) {
    return new Response("rate limited", { status: 429 });
  }

  const body = signUpBodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return refuse(400, "Fill in every field to create an account.");
  const parsed = body.data;
  if (!CODE_PATTERN.test(parsed.inviteCode)) return refuse(403, INVITE_REFUSED);

  // The claim. `.returning().get()` is undefined when the predicate matched
  // nothing — an unknown code and an already-redeemed one are the same answer.
  const claimed = await db
    .update(inviteCode)
    .set({ redeemedBy: parsed.email, redeemedAt: new Date() })
    .where(and(eq(inviteCode.code, parsed.inviteCode), isNull(inviteCode.redeemedAt)))
    .returning()
    .get();
  if (claimed === undefined) return refuse(403, INVITE_REFUSED);

  const response = await forwardSignUp(request, env, url.origin, parsed);
  if (!response.ok) {
    // Release, scoped to the email this request claimed with, so a concurrent
    // winner's claim can never be released by a loser.
    await db
      .update(inviteCode)
      .set({ redeemedBy: null, redeemedAt: null })
      .where(and(eq(inviteCode.code, parsed.inviteCode), eq(inviteCode.redeemedBy, parsed.email)));
  }
  return response;
}

/** Hand the sign-up to Better Auth's own handler and return its response as
 * it stands — `set-cookie` and `set-auth-token` included. Reached through the
 * handler rather than `auth.api.signUpEmail` because a rejected sign-up is
 * then an HTTP response to inspect rather than an exception to translate. */
function forwardSignUp(
  request: Request,
  env: Env,
  origin: string,
  body: SignUpBody,
): Promise<Response> {
  const headers = new Headers(request.headers);
  // The forwarded body is a different length, and an inherited `content-length`
  // would describe the one this route consumed.
  headers.delete("content-length");
  headers.set("content-type", "application/json");
  const forwarded = new Request(`${origin}/api/auth/sign-up/email`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: body.name, email: body.email, password: body.password }),
  });
  return createSignUpAuth(env, origin).handler(forwarded);
}
