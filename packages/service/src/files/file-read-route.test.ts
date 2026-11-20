import { CLIENT_BUILD_HEADER } from "@repo/contract/client-build";
import { V1_BLOBS_NAME_PARAM } from "@repo/contract/library/library-blobs";
import { PHONE_ORIGIN } from "@repo/contract/origin";
import { dbSuite } from "@repo/db/test-database";
import { expect, it } from "vitest";

import { signInPhone, signUpUser } from "../test-support/auth-requests.test-utils";
import { blobUrlOf, fileOf, sendFile, sha256Hex } from "../test-support/file-uploads.test-utils";
import {
  buildHeaders,
  extensionHeaders,
  FLOOR_VERSION,
  pageHeaders,
  phoneHeaders,
  v1Link,
} from "../test-support/v1-link.test-utils";
import { mintLibraryId } from "../library/library-ids";
import { fileReadRoute } from "./file-read-route";

const TEN = "0123456789";

const signedIn = async (email: string) => {
  const { cookie } = await signUpUser(email);
  const phone = await signInPhone(email);

  return { auth: phoneHeaders(phone), cookie, phone };
};

const read = async (sha: string, headers: Record<string, string>, method = "GET") =>
  await fileReadRoute(new Request(blobUrlOf(sha), { headers, method }));

const readNamed = async (sha: string, name: string, headers: Record<string, string>) => {
  const url = new URL(blobUrlOf(sha));
  url.searchParams.set(V1_BLOBS_NAME_PARAM, name);

  return await fileReadRoute(new Request(url, { headers }));
};

const drained = async (answer: Promise<Response>) => {
  const response = await answer;
  await response.arrayBuffer();

  return response;
};

const uploaded = async (auth: Record<string, string>, text = TEN, mime = "image/png") => {
  const file = fileOf(text);
  await sendFile(auth, file, mime);

  return file.sha;
};

dbSuite("a file's read", () => {
  it("reads back whole, and its head from the row alone", async () => {
    const { auth } = await signedIn("blob-read@example.test");
    const sha = await uploaded(auth);
    const whole = await read(sha, auth);
    expect(whole.status).toBe(200);
    await expect(whole.text()).resolves.toBe(TEN);
    expect(Object.fromEntries(whole.headers)).toMatchObject({
      "accept-ranges": "bytes",
      "content-length": "10",
      "content-security-policy": "default-src 'none'; sandbox",
      "content-type": "image/png",
      etag: `"${sha}"`,
      "x-content-type-options": "nosniff",
    });

    const head = await read(sha, auth, "HEAD");
    expect(head.status).toBe(200);
    expect(head.body).toBeNull();
    expect(head.headers.get("etag")).toBe(whole.headers.get("etag"));
    expect(head.headers.get("content-length")).toBe("10");
  });

  it("answers a single range, a suffix, a range past the end and a multi-part ask", async () => {
    const { auth } = await signedIn("blob-ranges@example.test");
    const sha = await uploaded(auth);
    const ranged = async (range: string) => await read(sha, { ...auth, range });

    const first = await ranged("bytes=2-5");
    expect(first.status).toBe(206);
    expect(first.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(first.headers.get("content-length")).toBe("4");
    await expect(first.text()).resolves.toBe("2345");

    const suffix = await ranged("bytes=-3");
    expect(suffix.status).toBe(206);
    expect(suffix.headers.get("content-range")).toBe("bytes 7-9/10");
    await expect(suffix.text()).resolves.toBe("789");

    const open = await ranged("bytes=8-");
    expect(open.status).toBe(206);
    await expect(open.text()).resolves.toBe("89");

    for (const whole of ["bytes=0-", "bytes=0-9", "bytes=0-99"]) {
      const answer = await ranged(whole);
      expect(answer.status, whole).toBe(206);
      expect(answer.headers.get("content-range"), whole).toBe("bytes 0-9/10");
      await expect(answer.text()).resolves.toBe(TEN);
    }

    const head = await read(sha, { ...auth, range: "bytes=2-5" }, "HEAD");
    expect(head.status).toBe(206);
    expect(head.headers.get("content-range")).toBe("bytes 2-5/10");

    for (const past of ["bytes=20-30", "bytes=10-", "bytes=-0"]) {
      const answer = await drained(ranged(past));
      expect(answer.status, past).toBe(416);
      expect(answer.headers.get("content-range"), past).toBe("bytes */10");
    }

    const parts = await ranged("bytes=0-1,4-5");
    expect(parts.status).toBe(200);
    expect(parts.headers.get("content-range")).toBeNull();
    await expect(parts.text()).resolves.toBe(TEN);
  });

  it("answers a range asked to the end of a long file a window at a time", async () => {
    const { auth } = await signedIn("blob-window@example.test");
    const size = 9 * 1024 * 1024;
    const bytes = new Uint8Array(size).fill(7);
    const sha = sha256Hex(bytes);
    await sendFile(auth, { bytes, sha }, "video/mp4");
    const window = 8 * 1024 * 1024;
    const first = await drained(read(sha, { ...auth, range: "bytes=0-" }));
    expect(first.status).toBe(206);
    expect(first.headers.get("content-range")).toBe(
      `bytes 0-${String(window - 1)}/${String(size)}`,
    );
    const rest = await drained(read(sha, { ...auth, range: `bytes=${String(window)}-` }));
    expect(rest.headers.get("content-range")).toBe(
      `bytes ${String(window)}-${String(size - 1)}/${String(size)}`,
    );
  });

  it("answers a copy the device holds as not modified, and a precondition that fails as 412", async () => {
    const { auth } = await signedIn("blob-revalidate@example.test");
    const sha = await uploaded(auth);
    const etag = `"${sha}"`;

    const held = await drained(read(sha, { ...auth, "if-none-match": etag }));
    expect(held.status).toBe(304);
    const weak = await drained(read(sha, { ...auth, "if-none-match": `"other", W/${etag}` }));
    expect(weak.status).toBe(304);
    const stale = await drained(read(sha, { ...auth, "if-none-match": '"other"' }));
    expect(stale.status).toBe(200);

    const rangedHeld = await read(sha, { ...auth, "if-none-match": etag, range: "bytes=0-1" });
    expect(rangedHeld.status).toBe(206);
    await expect(rangedHeld.text()).resolves.toBe("01");

    const mismatch = await drained(read(sha, { ...auth, "if-match": '"not-it"' }));
    expect(mismatch.status).toBe(412);
    const matched = await drained(read(sha, { ...auth, "if-match": etag }));
    expect(matched.status).toBe(200);
  });

  it("serves an html file under a sandbox with no script, and a PDF under its viewer's policy", async () => {
    const { auth } = await signedIn("blob-policies@example.test");

    const page = await uploaded(
      auth,
      "<html><script>alert(1)</script></html>",
      "text/html; charset=utf-8",
    );

    const html = await drained(read(page, auth));
    expect(html.headers.get("content-type")).toBe("text/html");
    expect(html.headers.get("content-security-policy")).toContain("sandbox");
    expect(html.headers.get("content-security-policy")).not.toContain("script-src");
    expect(html.headers.get("referrer-policy")).toBe("no-referrer");

    const pdf = await uploaded(auth, "%PDF-1.7", "application/pdf");
    const viewer = await drained(read(pdf, auth));
    expect(viewer.headers.get("content-security-policy")).not.toContain("sandbox");
    expect(viewer.headers.get("content-security-policy")).toContain("frame-ancestors 'self'");
  });

  it("is named by the name an item holds it under, the one asked for if an item holds it so, and never by another", async () => {
    const { auth, cookie } = await signedIn("blob-named@example.test");
    const { library } = v1Link(auth);
    const pdf = await uploaded(auth, "%PDF-1.7 named", "application/pdf");

    const nameOf = async (answer: Promise<Response>) => {
      const response = await drained(answer);

      return response.headers.get("content-disposition");
    };

    const saved = async (name: string, savedAt: number) =>
      await library.items.createFile({
        folderId: null,
        id: mintLibraryId(savedAt),
        name,
        savedAt,
        sha: pdf,
        tags: [],
      });

    await expect(nameOf(read(pdf, auth))).resolves.toBeNull();
    await expect(nameOf(readNamed(pdf, "invoice.html", auth))).resolves.toBeNull();

    const first = "Résumé 2026 (final) 'v2'*.pdf";
    await saved(first, 1_700_000_000_000);
    const named = await drained(read(pdf, pageHeaders(cookie)));
    const disposition = named.headers.get("content-disposition") ?? "";
    expect(disposition).toBe(
      "inline; filename*=UTF-8''R%C3%A9sum%C3%A9%202026%20%28final%29%20%27v2%27%2A.pdf",
    );
    expect(decodeURIComponent(disposition.split("''")[1] ?? "")).toBe(first);

    const second = "講義 notes.pdf";
    await saved(second, 1_700_000_000_001);
    await expect(nameOf(read(pdf, auth))).resolves.toBe(disposition);
    await expect(nameOf(readNamed(pdf, second, auth))).resolves.toBe(
      "inline; filename*=UTF-8''%E8%AC%9B%E7%BE%A9%20notes.pdf",
    );
    await expect(nameOf(readNamed(pdf, "invoice.html", auth))).resolves.toBe(disposition);
    await expect(nameOf(read(pdf, { ...auth, range: "bytes=0-1" }, "HEAD"))).resolves.toBe(
      disposition,
    );

    const unnamed = await drained(
      read(await uploaded(auth, "%PDF-1.7 other", "application/pdf"), pageHeaders(cookie)),
    );

    for (const header of [
      "cache-control",
      "content-security-policy",
      "content-type",
      "x-content-type-options",
    ]) {
      expect(named.headers.get(header), header).toBe(unnamed.headers.get(header));
    }
  });

  it("reads from the site's own tab, and out of every other account's reach", async () => {
    const mine = await signedIn("blob-mine@example.test");
    const theirs = await signedIn("blob-theirs@example.test");
    const sha = await uploaded(mine.auth, "only mine");

    const tab = await read(sha, pageHeaders(mine.cookie));
    expect(tab.status).toBe(200);
    await expect(tab.text()).resolves.toBe("only mine");
    const stranger = await drained(read(sha, theirs.auth));
    expect(stranger.status).toBe(404);
  });

  it("is kept by a tab's browser, and by no HTTP cache under a device, whose own a sign-out empties", async () => {
    const { auth, cookie } = await signedIn("blob-kept@example.test");
    const sha = await uploaded(auth);

    const tab = await drained(read(sha, pageHeaders(cookie)));
    expect(tab.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    const whole = await drained(read(sha, auth));
    expect(whole.headers.get("cache-control")).toBe("no-store");
    const extension = await drained(read(sha, extensionHeaders(cookie)));
    expect(extension.status).toBe(200);
    expect(extension.headers.get("cache-control")).toBe("no-store");
    const range = await drained(read(sha, { ...auth, range: "bytes=0-1" }));
    expect(range.status).toBe(206);
    expect(range.headers.get("cache-control")).toBe("no-store");
    const held = await drained(read(sha, { ...auth, "if-none-match": `"${sha}"` }));
    expect(held.status).toBe(304);
    expect(held.headers.get("cache-control")).toBe("no-store");
  });

  it("refuses an old build, no session and a name that is no sha", async () => {
    const { auth, phone } = await signedIn("blob-refusals@example.test");
    const { sha } = fileOf(TEN);
    const [major = "0", minor = "0"] = FLOOR_VERSION.split(".");
    const old = `${major}.${String(Number(minor) - 1)}.99+mobile`;

    const outdated = await drained(
      read(sha, { [CLIENT_BUILD_HEADER]: old, cookie: phone, "expo-origin": PHONE_ORIGIN }),
    );

    expect(outdated.status).toBe(426);
    await expect(drained(read(sha, buildHeaders()))).resolves.toMatchObject({ status: 401 });
    await expect(drained(read("not-a-sha", auth))).resolves.toMatchObject({ status: 404 });
  });
});
