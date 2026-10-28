// `/v1/blobs/<sha>` end to end: a file uploaded at the sha its bytes hash to, read back whole, by
// range and by revalidation, under the policy its kind is served with, and out of every other
// account's reach.

import { BLOB_MAX_BYTES, V1_BLOBS_PATH } from "@repo/contract/cloud/library/library-blobs";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  buildHeaders,
  deviceHeaders,
  drained,
  loginDevice,
  ORIGIN,
  sessionHeaders,
  signUpUser,
  userIdOf,
} from "../test-support/cloud-helpers";
import { cellOf, inCell } from "../test-support/library-cell";
import { blobKey } from "./cell-blobs";
import { addFileBytes } from "./cell-quota";
import { cellStorageOf } from "./cell-storage";

const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const fileOf = async (text: string) => {
  const bytes = new TextEncoder().encode(text);
  return { bytes, sha: await sha256Hex(bytes) };
};

const urlOf = (sha: string): string => `${ORIGIN}${V1_BLOBS_PATH}/${sha}`;

const signedIn = async (email: string) => {
  const { cookie } = await signUpUser(email);
  const laptop = await loginDevice(cookie, "Laptop");
  return { accountId: await userIdOf(cookie), auth: deviceHeaders(laptop.credential), cookie };
};

// an upload's status: its body is read to the end, so nothing of it is held open
const put = async (
  auth: Record<string, string>,
  sha: string,
  body: Uint8Array,
  type = "image/png",
): Promise<number> => {
  const response = await drained(
    exports.default.fetch(urlOf(sha), {
      body,
      headers: { ...auth, "content-type": type },
      method: "PUT",
    }),
  );
  return response.status;
};

const statusOf = async (url: string, init: RequestInit): Promise<number> => {
  const response = await drained(exports.default.fetch(url, init));
  return response.status;
};

const TEN = "0123456789";

describe("a file's bytes", () => {
  it("lands at the sha its bytes hash to, once, and reads back whole", async () => {
    const { accountId, auth } = await signedIn("blob-upload@example.test");
    const { bytes, sha } = await fileOf(TEN);
    expect(await put(auth, sha, bytes)).toBe(201);
    // the library holds it already: nothing is read, nothing stored twice
    expect(await put(auth, sha, bytes)).toBe(204);
    const object = await env.BLOBS.head(blobKey(accountId, sha));
    expect(object?.size).toBe(10);

    const read = await exports.default.fetch(urlOf(sha), { headers: auth });
    expect(read.status).toBe(200);
    expect(await read.text()).toBe(TEN);
    expect(read.headers.get("content-type")).toBe("image/png");
    expect(read.headers.get("content-length")).toBe("10");
    expect(read.headers.get("accept-ranges")).toBe("bytes");
    expect(read.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(read.headers.get("x-content-type-options")).toBe("nosniff");

    const head = await drained(
      exports.default.fetch(urlOf(sha), { headers: auth, method: "HEAD" }),
    );
    expect(head.status).toBe(200);
    expect(head.headers.get("etag")).toBe(read.headers.get("etag"));
  });

  it("refuses bytes that hash to another sha, and keeps none of them", async () => {
    const { accountId, auth } = await signedIn("blob-mismatch@example.test");
    const { sha } = await fileOf("the bytes the address names");
    const sent = new TextEncoder().encode("other bytes entirely");
    expect(await put(auth, sha, sent)).toBe(400);
    expect(await env.BLOBS.head(blobKey(accountId, sha))).toBeNull();
    // the room it held is let go: the right bytes land after
    const { bytes, sha: actual } = await fileOf("the bytes the address names");
    expect(await put(auth, actual, bytes)).toBe(201);
  });

  it("refuses an upload with no length, one past the cap, and one past the library's room", async () => {
    const { accountId, auth } = await signedIn("blob-limits@example.test");
    const { bytes, sha } = await fileOf(TEN);
    const unsized = await drained(
      exports.default.fetch(urlOf(sha), {
        body: new ReadableStream({
          start: (controller) => {
            controller.enqueue(bytes);
            controller.close();
          },
        }),
        headers: auth,
        method: "PUT",
      }),
    );
    expect(unsized.status).toBe(411);

    const huge = await drained(
      exports.default.fetch(urlOf(sha), {
        body: bytes,
        headers: { ...auth, "content-length": String(BLOB_MAX_BYTES + 1) },
        method: "PUT",
      }),
    );
    expect(huge.status).toBe(413);

    await inCell(cellOf(accountId), (state) => {
      addFileBytes(cellStorageOf(state.storage), Number(env.LIBRARY_STORAGE_CAP_BYTES));
    });
    expect(await put(auth, sha, bytes)).toBe(507);
  });

  it("answers a single range, a suffix, a range past the end and a multi-part ask", async () => {
    const { auth } = await signedIn("blob-ranges@example.test");
    const { bytes, sha } = await fileOf(TEN);
    await put(auth, sha, bytes);
    const ranged = async (range: string) =>
      await exports.default.fetch(urlOf(sha), { headers: { ...auth, range } });

    const first = await ranged("bytes=2-5");
    expect(first.status).toBe(206);
    expect(first.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(first.headers.get("content-length")).toBe("4");
    expect(await first.text()).toBe("2345");

    const suffix = await ranged("bytes=-3");
    expect(suffix.status).toBe(206);
    expect(suffix.headers.get("content-range")).toBe("bytes 7-9/10");
    expect(await suffix.text()).toBe("789");

    const open = await ranged("bytes=8-");
    expect(open.status).toBe(206);
    expect(await open.text()).toBe("89");

    // a range that spans the file is still the range asked for, as a media loader's probe needs
    for (const whole of ["bytes=0-", "bytes=0-9", "bytes=0-99"]) {
      const answer = await ranged(whole);
      expect(answer.status, whole).toBe(206);
      expect(answer.headers.get("content-range"), whole).toBe("bytes 0-9/10");
      expect(await answer.text()).toBe(TEN);
    }

    const past = await drained(ranged("bytes=20-30"));
    expect(past.status).toBe(416);
    expect(past.headers.get("content-range")).toBe("bytes */10");

    // a multi-part ask is answered whole, as a server may
    const parts = await ranged("bytes=0-1,4-5");
    expect(parts.status).toBe(200);
    expect(parts.headers.get("content-range")).toBeNull();
    expect(await parts.text()).toBe(TEN);
  });

  it("answers a copy the device holds as not modified, and a precondition that fails as 412", async () => {
    const { auth } = await signedIn("blob-revalidate@example.test");
    const { bytes, sha } = await fileOf(TEN);
    await put(auth, sha, bytes);
    const whole = await drained(exports.default.fetch(urlOf(sha), { headers: auth }));
    const etag = whole.headers.get("etag") ?? "";

    const held = await drained(
      exports.default.fetch(urlOf(sha), { headers: { ...auth, "if-none-match": etag } }),
    );
    expect(held.status).toBe(304);

    // a media loader revalidates every range it reads; it is answered its range
    const rangedHeld = await exports.default.fetch(urlOf(sha), {
      headers: { ...auth, "if-none-match": etag, range: "bytes=0-1" },
    });
    expect(rangedHeld.status).toBe(206);
    expect(await rangedHeld.text()).toBe("01");

    const mismatch = await drained(
      exports.default.fetch(urlOf(sha), { headers: { ...auth, "if-match": '"not-it"' } }),
    );
    expect(mismatch.status).toBe(412);
  });

  it("serves a page copy under a sandbox with no script, and a PDF under its viewer's policy", async () => {
    const { auth } = await signedIn("blob-policies@example.test");
    const page = await fileOf("<html><script>alert(1)</script></html>");
    await put(auth, page.sha, page.bytes, "text/html; charset=utf-8");
    const copy = await drained(exports.default.fetch(urlOf(page.sha), { headers: auth }));
    expect(copy.headers.get("content-security-policy")).toContain("sandbox");
    expect(copy.headers.get("content-security-policy")).not.toContain("script-src");
    expect(copy.headers.get("referrer-policy")).toBe("no-referrer");

    const pdf = await fileOf("%PDF-1.7");
    await put(auth, pdf.sha, pdf.bytes, "application/pdf");
    const viewer = await drained(exports.default.fetch(urlOf(pdf.sha), { headers: auth }));
    expect(viewer.headers.get("content-security-policy")).not.toContain("sandbox");
    expect(viewer.headers.get("content-security-policy")).toContain("frame-ancestors 'self'");
  });

  it("reads from the site's own tab, and out of every other account's reach", async () => {
    const mine = await signedIn("blob-mine@example.test");
    const theirs = await signedIn("blob-theirs@example.test");
    const { bytes, sha } = await fileOf("only mine");
    await put(mine.auth, sha, bytes);

    const tab = await exports.default.fetch(urlOf(sha), { headers: sessionHeaders(mine.cookie) });
    expect(tab.status).toBe(200);
    expect(await tab.text()).toBe("only mine");
    const stranger = await drained(exports.default.fetch(urlOf(sha), { headers: theirs.auth }));
    expect(stranger.status).toBe(404);
  });

  it("refuses an old build, no credential, a name that is no sha and any other method", async () => {
    const { auth } = await signedIn("blob-refusals@example.test");
    const { sha } = await fileOf(TEN);
    expect(
      await statusOf(urlOf(sha), { headers: { authorization: auth.authorization ?? "" } }),
    ).toBe(426);
    expect(await statusOf(urlOf(sha), { headers: buildHeaders() })).toBe(401);
    expect(await statusOf(urlOf("not-a-sha"), { headers: auth })).toBe(404);
    const post = await drained(
      exports.default.fetch(urlOf(sha), { headers: auth, method: "POST" }),
    );
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET, HEAD, PUT");
  });
});
