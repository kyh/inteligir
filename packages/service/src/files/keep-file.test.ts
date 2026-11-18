// Bytes the cloud holds itself, kept as an upload is and named by the sha they hash to.

import { db } from "@repo/db/drizzle-client";
import { file } from "@repo/db/library-schema";
import { dbSuite } from "@repo/db/test-database";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";

import { env } from "../env";
import { fileOf } from "../test-support/file-uploads";
import { makeAccount, seedFile } from "../test-support/library-fixture";
import { FILE_STORE } from "./file-store-of";
import { keepFile } from "./keep-file";

dbSuite(keepFile, () => {
  it("keeps the bytes for good under their sha, once", async () => {
    const accountId = await makeAccount();
    const writer = { accountId, actor: { kind: "fill" as const } };
    const { bytes, sha } = fileOf("a page's cover");
    await expect(keepFile(writer, bytes, "image/webp; q=1")).resolves.toStrictEqual({
      ok: true,
      value: sha,
    });
    const rows = await db.select().from(file).where(eq(file.accountId, accountId));
    expect(rows).toMatchObject([{ bytes: bytes.byteLength, mime: "image/webp", sha256: sha }]);
    const [row] = rows;
    await expect(FILE_STORE.head(row?.pathname ?? "")).resolves.toMatchObject({ expiresAt: null });

    await expect(keepFile(writer, bytes, "image/webp")).resolves.toStrictEqual({
      ok: true,
      value: sha,
    });
    await expect(
      db.select().from(file).where(eq(file.accountId, accountId)),
    ).resolves.toStrictEqual(rows);
  });

  it("refuses bytes past the library's room, and lets them go", async () => {
    const accountId = await makeAccount();
    const bytesCap = env.LIBRARY_STORAGE_CAP_BYTES;
    await seedFile(accountId, "f".repeat(64), { bytes: bytesCap });
    const { bytes } = fileOf("one byte too many");
    await expect(
      keepFile({ accountId, actor: { kind: "fill" } }, bytes, "image/png"),
    ).resolves.toMatchObject({ ok: false, refusal: { kind: "quota" } });
    const rows = await db.select().from(file).where(eq(file.accountId, accountId));
    expect(rows.map((row) => row.sha256)).toStrictEqual(["f".repeat(64)]);
  });
});
