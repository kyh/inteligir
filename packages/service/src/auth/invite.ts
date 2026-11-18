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

const INVITE_REFUSED = "That invite code doesn't work.";

const signUpBodyRefusal = (error: z.ZodError) =>
  error.issues.every((issue) => issue.path[0] === "password")
    ? `Use a password of ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters.`
    : "Fill in every field to create an account.";

const formRefusal = (status: number, message: string) => Response.json({ message }, { status });

const forwardSignUp = async (request: Request, body: SignUpRequest) => {
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  headers.set("content-type", "application/json");

  const forwarded = new Request(new URL("/api/auth/sign-up/email", request.url), {
    body: JSON.stringify({ email: body.email, name: body.name, password: body.password }),
    headers,
    method: "POST",
  });

  return withoutAuthToken(await getSignUpAuth().handler(forwarded));
};

export const handleInviteSignUp = async (request: Request) => {
  if (!(await spendCallerBudget("inviteSignUp", request))) {
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
