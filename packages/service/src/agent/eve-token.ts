import { signJWT, verifyJWT } from "better-auth/crypto";
import { z } from "zod";

import { deriveSecret } from "../auth/derive-secret";

const EVE_TOKEN_TTL_SECONDS = 5 * 60;

const claimsSchema = z.object({
  eveSessionId: z.string().min(1).optional(),
  eveSessionNumber: z.int().positive(),
  sub: z.string().min(1),
  threadId: z.uuid(),
});

export interface EveTokenSubject {
  readonly accountId: string;
  readonly threadId: string;
  readonly eveSessionNumber: number;
  readonly eveSessionId: string | null;
}

type VerifiedEveToken =
  | { readonly ok: true; readonly subject: EveTokenSubject }
  | { readonly ok: false; readonly message: string };

export const eveOperationId = (threadId: string, eveSessionNumber: number) =>
  `${threadId}.${String(eveSessionNumber)}`;

const signingSecret = () => deriveSecret("eve-token").toString("base64url");

export const mintEveToken = async (subject: EveTokenSubject) => {
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

export const verifyEveToken = async (token: string) => {
  const payload: unknown = await verifyJWT(token, signingSecret());
  const claims = claimsSchema.safeParse(payload);

  if (!claims.success) {
    return {
      message: "The agent token is invalid or expired.",
      ok: false,
    } satisfies VerifiedEveToken;
  }

  return {
    ok: true,
    subject: {
      accountId: claims.data.sub,
      eveSessionId: claims.data.eveSessionId ?? null,
      eveSessionNumber: claims.data.eveSessionNumber,
      threadId: claims.data.threadId,
    },
  } satisfies VerifiedEveToken;
};
