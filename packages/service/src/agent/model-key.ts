import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { agentPreference } from "@repo/db/agent-schema";
import { db } from "@repo/db/drizzle-client";
import type { DbExecutor } from "@repo/db/drizzle-client";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { deriveSecret } from "../derive-secret";
import type { WriteScope } from "../library/library-store";

export const modelKeyAnswerSchema = z.object({ hint: z.string().nullable() });

const SEAL = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HINT_LENGTH = 4;

const sealKey = (key: string) => {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(SEAL, deriveSecret("model-key"), iv);
  const sealed = Buffer.concat([cipher.update(key, "utf-8"), cipher.final()]);

  return Buffer.concat([iv, cipher.getAuthTag(), sealed]).toString("base64");
};

const openKey = (stored: string) => {
  const bytes = Buffer.from(stored, "base64");
  const decipher = createDecipheriv(SEAL, deriveSecret("model-key"), bytes.subarray(0, IV_BYTES));
  decipher.setAuthTag(bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));

  try {
    return Buffer.concat([
      decipher.update(bytes.subarray(IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]).toString("utf-8");
  } catch {
    return null;
  }
};

const keyRow = async (accountId: string, executor: DbExecutor) => {
  const [row] = await executor
    .select({ hint: agentPreference.modelKeyHint, sealed: agentPreference.modelKey })
    .from(agentPreference)
    .where(eq(agentPreference.accountId, accountId));

  return row ?? null;
};

export const heldKeyHint = async (accountId: string) => {
  const row = await keyRow(accountId, db);

  return { hint: row?.hint ?? null };
};

export const ownModelKey = async (accountId: string, executor: DbExecutor = db) => {
  const row = await keyRow(accountId, executor);

  return row === null || row.sealed === null ? null : openKey(row.sealed);
};

export const writeModelKey = async (scope: WriteScope, key: string | null) => {
  const modelKey = key === null ? null : sealKey(key);
  const modelKeyHint = key === null ? null : key.slice(-HINT_LENGTH);

  await scope.tx
    .insert(agentPreference)
    .values({ accountId: scope.accountId, enabled: true, modelKey, modelKeyHint })
    .onConflictDoUpdate({ set: { modelKey, modelKeyHint }, target: agentPreference.accountId });

  return { hint: modelKeyHint } satisfies z.input<typeof modelKeyAnswerSchema>;
};
