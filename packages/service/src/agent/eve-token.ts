// Only the app calls eve: it signs one of these for each call, so a token that leaks opens one
// session, as one account, for minutes. Signed and checked with a key of this purpose alone,
// derived from the auth secret: eve's channel runs in this deployment and admits with them
// (`./eve-admission`), so no key is stored or served.

import { signJWT, verifyJWT } from "better-auth/crypto";
import { z } from "zod";

import { deriveSecret } from "../auth/derive-secret";

const EVE_TOKEN_TTL_SECONDS = 5 * 60;

const claimsSchema = z.object({
  // absent on a token that creates the eve session; then only that creation is open to it
  eveSessionId: z.string().min(1).optional(),
  eveSessionNumber: z.int().positive(),
  sub: z.string().min(1),
  threadId: z.uuid(),
});

export interface EveTokenSubject {
  readonly accountId: string;
  readonly threadId: string;
  // which of the thread's eve sessions: a thread starts another once one ends or ages
  readonly eveSessionNumber: number;
  readonly eveSessionId: string | null;
}

type VerifiedEveToken =
  | { readonly ok: true; readonly subject: EveTokenSubject }
  | { readonly ok: false; readonly message: string };

// the create's `operationId`: one per eve session of a thread, so a retry makes none
export const eveOperationId = (threadId: string, eveSessionNumber: number): string =>
  `${threadId}.${String(eveSessionNumber)}`;

const signingSecret = (): string => deriveSecret("eve-token").toString("base64url");

export const mintEveToken = async (subject: EveTokenSubject): Promise<string> => {
  const claims: z.input<typeof claimsSchema> = {
    eveSessionNumber: subject.eveSessionNumber,
    sub: subject.accountId,
    threadId: subject.threadId,
  };
  if (subject.eveSessionId !== null) {
    claims.eveSessionId = subject.eveSessionId;
  }
  return await signJWT(claims, signingSecret(), EVE_TOKEN_TTL_SECONDS);
};

export const verifyEveToken = async (token: string): Promise<VerifiedEveToken> => {
  const payload: unknown = await verifyJWT(token, signingSecret());
  const claims = claimsSchema.safeParse(payload);
  if (!claims.success) {
    return { message: "The agent token is invalid or expired.", ok: false };
  }
  return {
    ok: true,
    subject: {
      accountId: claims.data.sub,
      eveSessionId: claims.data.eveSessionId ?? null,
      eveSessionNumber: claims.data.eveSessionNumber,
      threadId: claims.data.threadId,
    },
  };
};
