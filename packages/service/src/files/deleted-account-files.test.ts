import { randomUUID } from "node:crypto";

import { user } from "@repo/db/auth-schema";
import { db } from "@repo/db/drizzle-client";
import { dbSuite } from "@repo/db/test-database";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";

import { makeAccount } from "../test-support/library.fixture";
import { emptyDeletedAccounts } from "./deleted-account-files";
import { accountFilesPrefix } from "./file-landing";
import { FILE_STORE } from "./file-store-of";

const BYTES = new TextEncoder().encode("bytes");
const MINUTE_MS = 60_000;

const keptFileOf = async (accountId: string) => {
  const pathname = `${accountFilesPrefix(accountId)}${"a".repeat(64)}/${randomUUID()}`;
  await FILE_STORE.put(pathname, BYTES, "image/png");
  await FILE_STORE.keep(pathname);

  return pathname;
};

dbSuite("emptying deleted accounts' files", () => {
  it("empties the folder of an account that went, one kept after it went too, and keeps a standing account's", async () => {
    const standing = await makeAccount();
    const deleted = await makeAccount();
    const standingFile = await keptFileOf(standing);
    const deletedFiles = [await keptFileOf(deleted), await keptFileOf(deleted)];
    await db.delete(user).where(eq(user.id, deleted));
    deletedFiles.push(await keptFileOf(deleted));

    await expect(emptyDeletedAccounts(Date.now() + MINUTE_MS)).resolves.toBe(1);

    for (const pathname of deletedFiles) {
      await expect(FILE_STORE.head(pathname)).resolves.toBeNull();
    }

    await expect(FILE_STORE.head(standingFile)).resolves.toMatchObject({ expiresAt: null });
    await expect(emptyDeletedAccounts(Date.now() + MINUTE_MS)).resolves.toBe(0);
  });
});
