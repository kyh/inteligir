import { BLOB_MAX_BYTES } from "@repo/contract/library/library-blobs";
import { user } from "@repo/db/auth-schema";
import { db } from "@repo/db/drizzle-client";
import { file, libraryState } from "@repo/db/library-schema";
import { dbSuite } from "@repo/db/test-database";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { env } from "../env";
import { mintLibraryId } from "../library/library-ids";
import { buildHeaders, phoneHeaders, v1Link } from "../test-support/v1-link.test-utils";
import { signInPhone, signUpUser, userIdOf } from "../test-support/auth-requests.test-utils";
import { fileOf, putTo, sendFile } from "../test-support/file-uploads.test-utils";
import { personalLibrary, seedFile } from "../test-support/library.fixture";
import { releaseUnnamedFiles } from "./file-release";
import { FILE_STORE } from "./file-store-of";

const TEN = "0123456789";

type Library = Awaited<ReturnType<typeof personalLibrary>>["library"];

const reserved = async (library: Library, sha: string, mime = "image/png") => {
  const answer = await library.files.reserve({ bytes: 10, mime, sha });

  if (answer.kind !== "upload") {
    throw new Error("the library held a file the test reserved");
  }

  const pathname = new URL(answer.url, "http://cloud.test").searchParams.get("pathname") ?? "";

  return { ...answer, pathname };
};

const rowOf = async (accountId: string, sha: string) => {
  const [row] = await db.select().from(file).where(eq(file.accountId, accountId));

  return row?.sha256 === sha ? row : null;
};

const housekeep = async (accountId: string) => {
  await db.insert(libraryState).values({ accountId }).onConflictDoNothing();
  await db.transaction(async (tx) => await releaseUnnamedFiles(tx, Date.now()));
};

const signedIn = async (email: string) => {
  const { cookie } = await signUpUser(email);
  const phone = phoneHeaders(await signInPhone(email));

  return { accountId: await userIdOf(cookie), phone };
};

dbSuite("reserve", () => {
  it("names an upload on the cloud's own origin, at the type it was sent as", async () => {
    const { library } = await personalLibrary();
    const { sha } = fileOf(TEN);
    const upload = await reserved(library, sha, "Image/PNG; charset=binary");
    expect(upload.url).toMatch(/^\/api\/dev\/files\?/u);
    expect(upload.headers).toStrictEqual({ "content-type": "image/png" });
    expect(upload.pathname).toMatch(new RegExp(`^files/[^/]+/${sha}/[^/]+$`, "u"));
    const unknown = await reserved(library, sha, "not a type");
    expect(unknown.headers).toStrictEqual({ "content-type": "application/octet-stream" });
    expect(unknown.uploadId).not.toBe(upload.uploadId);
  });

  it("answers held for a file the library holds, which is never sent again", async () => {
    const { accountId, library } = await personalLibrary();
    const { sha } = fileOf(TEN);
    await seedFile(accountId, sha);
    await expect(
      library.files.reserve({ bytes: 10, mime: "image/png", sha }),
    ).resolves.toStrictEqual({ kind: "held" });
  });

  it("refuses a file past 100 MiB, and one past the library's room", async () => {
    const { accountId, library } = await personalLibrary();
    const { sha } = fileOf(TEN);
    await expect(
      library.files.reserve({ bytes: BLOB_MAX_BYTES + 1, mime: "video/mp4", sha }),
    ).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
      message: "This file is larger than your library keeps.",
    });
    const bytesCap = env.LIBRARY_STORAGE_CAP_BYTES;
    await seedFile(accountId, "f".repeat(64), { bytes: bytesCap });
    await expect(
      library.files.reserve({ bytes: 10, mime: "image/png", sha }),
    ).rejects.toMatchObject({ code: "QUOTA", data: { bytesCap, bytesUsed: bytesCap } });
  });
});

dbSuite("settle", () => {
  it("keeps what was sent for good, and finds it kept when sent again", async () => {
    const { accountId, library } = await personalLibrary();
    const { bytes, sha } = fileOf(TEN);
    const upload = await reserved(library, sha);
    await expect(putTo(upload.url, bytes, "image/png")).resolves.toMatchObject({ status: 200 });
    await expect(FILE_STORE.head(upload.pathname)).resolves.toMatchObject({
      expiresAt: expect.any(Number),
    });

    const settle = { sha, uploadId: upload.uploadId };
    await expect(library.files.settle(settle)).resolves.toStrictEqual({ kind: "kept" });
    await expect(FILE_STORE.head(upload.pathname)).resolves.toStrictEqual({
      bytes: 10,
      expiresAt: null,
      mime: "image/png",
    });
    await expect(rowOf(accountId, sha)).resolves.toMatchObject({
      bytes: 10,
      mime: "image/png",
      pathname: upload.pathname,
    });
    await expect(library.files.settle(settle)).resolves.toStrictEqual({ kind: "kept" });
  });

  it("answers held for a copy the library came to hold, and lets the copy go", async () => {
    const { accountId, library } = await personalLibrary();
    const { bytes, sha } = fileOf(TEN);
    const first = await reserved(library, sha);
    const second = await reserved(library, sha);
    await putTo(first.url, bytes, "image/png");
    await putTo(second.url, bytes, "image/png");
    await expect(library.files.settle({ sha, uploadId: first.uploadId })).resolves.toStrictEqual({
      kind: "kept",
    });
    await expect(library.files.settle({ sha, uploadId: second.uploadId })).resolves.toStrictEqual({
      kind: "held",
    });
    await expect(FILE_STORE.head(second.pathname)).resolves.toBeNull();
    await expect(rowOf(accountId, sha)).resolves.toMatchObject({ pathname: first.pathname });
  });

  it("refuses bytes that hash to another sha, or more than were reserved, and lets them go", async () => {
    const { accountId, library } = await personalLibrary();
    const { sha } = fileOf(TEN);
    const swapped = await reserved(library, sha);
    await putTo(swapped.url, fileOf("9876543210").bytes, "image/png");
    await expect(library.files.settle({ sha, uploadId: swapped.uploadId })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "This file changed on this device before it was sent.",
    });
    await expect(FILE_STORE.head(swapped.pathname)).resolves.toBeNull();

    const short = await reserved(library, sha);
    await putTo(short.url, fileOf("01234").bytes, "image/png");
    await expect(library.files.settle({ sha, uploadId: short.uploadId })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });

    const long = await reserved(library, sha);
    await FILE_STORE.put(long.pathname, fileOf("0123456789ab").bytes, "image/png");
    await expect(library.files.settle({ sha, uploadId: long.uploadId })).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
      message: "This file is larger than your library keeps.",
    });
    await expect(FILE_STORE.head(long.pathname)).resolves.toBeNull();
    await expect(rowOf(accountId, sha)).resolves.toBeNull();
  });

  it("finds no upload it never signed, none not sent yet, and none of another account's", async () => {
    const { library } = await personalLibrary();
    const other = await personalLibrary();
    const { bytes, sha } = fileOf(TEN);
    const upload = await reserved(library, sha);
    const notFound = { code: "NOT_FOUND" };
    await expect(library.files.settle({ sha, uploadId: upload.uploadId })).rejects.toMatchObject(
      notFound,
    );
    await putTo(upload.url, bytes, "image/png");
    const [body = ""] = upload.uploadId.split(".");

    for (const uploadId of [`${body}.forged`, "nonsense"]) {
      await expect(library.files.settle({ sha, uploadId })).rejects.toMatchObject(notFound);
    }

    await expect(
      library.files.settle({ sha: fileOf("other").sha, uploadId: upload.uploadId }),
    ).rejects.toMatchObject(notFound);
    await expect(
      other.library.files.settle({ sha, uploadId: upload.uploadId }),
    ).rejects.toMatchObject(notFound);
    await expect(library.files.settle({ sha, uploadId: upload.uploadId })).resolves.toStrictEqual({
      kind: "kept",
    });
  });

  it("refuses a file past the room the library has left by the time it settles", async () => {
    const { accountId, library } = await personalLibrary();
    const { bytes, sha } = fileOf(TEN);
    const upload = await reserved(library, sha);
    await putTo(upload.url, bytes, "image/png");
    const bytesCap = env.LIBRARY_STORAGE_CAP_BYTES;
    await seedFile(accountId, "f".repeat(64), { bytes: bytesCap });
    await expect(library.files.settle({ sha, uploadId: upload.uploadId })).rejects.toMatchObject({
      code: "QUOTA",
      data: { bytesCap, bytesUsed: bytesCap },
    });
    await expect(FILE_STORE.head(upload.pathname)).resolves.toBeNull();
  });

  it("refuses an account deleted while its upload was on its way", async () => {
    const { accountId, library } = await personalLibrary();
    const { bytes, sha } = fileOf(TEN);
    const upload = await reserved(library, sha);
    await putTo(upload.url, bytes, "image/png");
    await db.delete(user).where(eq(user.id, accountId));
    await expect(library.files.settle({ sha, uploadId: upload.uploadId })).rejects.toMatchObject({
      code: "GONE",
      message: "This account was deleted.",
    });
    await expect(FILE_STORE.head(upload.pathname)).resolves.toBeNull();
  });
});

dbSuite("a held answer", () => {
  it("holds the file a day for the write naming it, past housekeeping's next release", async () => {
    const { accountId, library } = await personalLibrary();
    const { sha } = fileOf(TEN);
    await seedFile(accountId, sha, { touchedAt: 1 });
    await expect(
      library.files.reserve({ bytes: 10, mime: "image/png", sha }),
    ).resolves.toStrictEqual({ kind: "held" });
    await housekeep(accountId);
    const savedAt = Date.now();
    await expect(
      library.items.createFile({
        folderId: null,
        id: mintLibraryId(savedAt),
        name: "photo.png",
        savedAt,
        sha,
        tags: [],
      }),
    ).resolves.toMatchObject({ item: { fields: { originalSha: sha } } });
  });

  it("holds the file a settle of a copy answers held for", async () => {
    const { accountId, library } = await personalLibrary();
    const { bytes, sha } = fileOf(TEN);
    const first = await reserved(library, sha);
    const second = await reserved(library, sha);
    await putTo(first.url, bytes, "image/png");
    await putTo(second.url, bytes, "image/png");
    await library.files.settle({ sha, uploadId: first.uploadId });
    await db.update(file).set({ touchedAt: 1 }).where(eq(file.accountId, accountId));
    await expect(library.files.settle({ sha, uploadId: second.uploadId })).resolves.toStrictEqual({
      kind: "held",
    });
    await housekeep(accountId);
    await expect(rowOf(accountId, sha)).resolves.toMatchObject({ pathname: first.pathname });
  });

  it("is an upload again once housekeeping let the file go", async () => {
    const { accountId, library } = await personalLibrary();
    const { sha } = fileOf(TEN);
    await seedFile(accountId, sha, { touchedAt: 1 });
    await housekeep(accountId);
    await expect(rowOf(accountId, sha)).resolves.toBeNull();
    await expect(
      library.files.reserve({ bytes: 10, mime: "image/png", sha }),
    ).resolves.toMatchObject({ kind: "upload" });
  });
});

dbSuite("an upload end to end", () => {
  it("lands through a device's own client, and is held the next time", async () => {
    const { accountId, phone } = await signedIn("files-device@example.test");
    const ten = fileOf(TEN);
    await expect(sendFile(phone, ten)).resolves.toBeUndefined();
    await expect(rowOf(accountId, ten.sha)).resolves.toMatchObject({ bytes: 10 });
    await expect(sendFile(phone, ten)).resolves.toBeUndefined();
    const link = v1Link(phone);
    await expect(
      link.library.files.reserve({ bytes: 10, mime: "image/png", sha: ten.sha }),
    ).resolves.toStrictEqual({ kind: "held" });
  });

  it("refuses it in the wire's own errors, which a client reads as a call's", async () => {
    const { accountId, phone } = await signedIn("files-refusals@example.test");
    const ten = fileOf(TEN);
    await expect(
      sendFile(phone, { bytes: fileOf("9876543210").bytes, sha: ten.sha }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", defined: true });
    await expect(sendFile(buildHeaders(), ten)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      defined: true,
    });
    const bytesCap = env.LIBRARY_STORAGE_CAP_BYTES;
    await seedFile(accountId, "f".repeat(64), { bytes: bytesCap });
    await expect(sendFile(phone, ten)).rejects.toMatchObject({
      code: "QUOTA",
      data: { bytesCap, bytesUsed: bytesCap },
      defined: true,
      message: "Your library is full.",
    });
  });
});

describe("the folder store's upload route", () => {
  dbSuite("an upload's address", () => {
    it("takes the one object it signs, once, at its type and size, before its time", async () => {
      const { library } = await personalLibrary();
      const { bytes, sha } = fileOf(TEN);
      const upload = await reserved(library, sha);
      await expect(putTo(upload.url, bytes, "image/jpeg")).resolves.toMatchObject({ status: 403 });
      await expect(
        putTo(upload.url, fileOf("0123456789ab").bytes, "image/png"),
      ).resolves.toMatchObject({ status: 413 });
      const tampered = upload.url.replace("bytes=10", "bytes=12");
      await expect(putTo(tampered, bytes, "image/png")).resolves.toMatchObject({ status: 403 });
      await expect(putTo(upload.url, bytes, "image/png")).resolves.toMatchObject({ status: 200 });
      await expect(putTo(upload.url, bytes, "image/png")).resolves.toMatchObject({ status: 409 });

      const late = await reserved(library, fileOf("late").sha);
      vi.useFakeTimers({ now: Date.now() + 2 * 60 * 60 * 1000, toFake: ["Date"] });

      try {
        await expect(putTo(late.url, bytes, "image/png")).resolves.toMatchObject({ status: 403 });
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
