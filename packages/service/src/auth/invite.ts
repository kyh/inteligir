import {
  SIGN_IN_CODE_REFUSED,
  signUpCodeRequestSchema,
  signUpRequestSchema,
} from "@repo/contract/account/account-schema";
import type { SignUpRequest } from "@repo/contract/account/account-schema";
import { APIError } from "better-auth/api";
import type { z } from "zod";

import { spendCallerBudget } from "../rate-limit";
import { getSignUpAuth, withoutAuthToken } from "./auth";
import { claimInvite, inviteOpen, releaseInvite } from "./invite-codes";

const INVITE_REFUSED = "That invite code doesn't work.";
const ACCOUNT_EXISTS = "An account already uses that email. Sign in instead.";

const signUpBodyRefusal = (error: z.ZodError) =>
  error.issues.every((issue) => issue.path[0] === "code")
    ? SIGN_IN_CODE_REFUSED
    : "Fill in every field to create an account.";

const formRefusal = (status: number, message: string) => Response.json({ message }, { status });

const accountExists = async (email: string) => {
  const { internalAdapter } = await getSignUpAuth().$context;

  return (await internalAdapter.findUserByEmail(email.toLowerCase())) !== null;
};

const parsedBody = async <T extends z.ZodType>(request: Request, schema: T) => {
  const spent = await spendCallerBudget("inviteSignUp", request);

  if (spent.kind === "refused") {
    return {
      kind: "refused",
      refusal: formRefusal(429, "Too many attempts — wait a minute."),
    } as const;
  }

  return {
    body: schema.safeParse(await request.json().catch(() => null)),
    kind: "read",
  } as const;
};

export const handleSignUpCode = async (request: Request) => {
  const read = await parsedBody(request, signUpCodeRequestSchema);

  if (read.kind === "refused") {
    return read.refusal;
  }

  if (!read.body.success) {
    return formRefusal(400, "Fill in every field to create an account.");
  }

  const { email, inviteCode } = read.body.data;

  if (!(await inviteOpen(inviteCode))) {
    return formRefusal(403, INVITE_REFUSED);
  }

  if (await accountExists(email)) {
    return formRefusal(409, ACCOUNT_EXISTS);
  }

  try {
    await getSignUpAuth().api.sendVerificationOTP({ body: { email, type: "sign-in" } });
  } catch (error) {
    if (error instanceof APIError) {
      return formRefusal(error.statusCode, error.message);
    }

    throw error;
  }

  return Response.json({ sent: true });
};

const forwardSignUp = async (request: Request, body: SignUpRequest) => {
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  headers.set("content-type", "application/json");

  const forwarded = new Request(new URL("/api/auth/sign-in/email-otp", request.url), {
    body: JSON.stringify({ email: body.email, name: body.name, otp: body.code }),
    headers,
    method: "POST",
  });

  return withoutAuthToken(await getSignUpAuth().handler(forwarded));
};

export const handleInviteSignUp = async (request: Request) => {
  const read = await parsedBody(request, signUpRequestSchema);

  if (read.kind === "refused") {
    return read.refusal;
  }

  if (!read.body.success) {
    return formRefusal(400, signUpBodyRefusal(read.body.error));
  }

  const parsed = read.body.data;

  if (await accountExists(parsed.email)) {
    return formRefusal(409, ACCOUNT_EXISTS);
  }

  if (!(await claimInvite(parsed.inviteCode, parsed.email))) {
    return formRefusal(403, INVITE_REFUSED);
  }

  const response = await forwardSignUp(request, parsed);

  if (response.ok) {
    return response;
  }

  await releaseInvite(parsed.inviteCode, parsed.email);

  return response.status === 400 || response.status === 403
    ? formRefusal(400, SIGN_IN_CODE_REFUSED)
    : response;
};
