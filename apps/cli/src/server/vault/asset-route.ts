// not a procedure: an rpc envelope cannot carry an etag, a 304, a byte range or its own csp.

import { vaultAssetQuerySchema } from "@repo/contract/local/routes";
import { assetKind, assetMediaType } from "@repo/contract/local/vault/vault-schema";
import type { AssetKind } from "@repo/contract/cloud/vault/vault-schema";
import { basenamePath } from "@repo/notes/knowledge/vault-path";
import type { Context } from "hono";
import { parseByteRange, rangeApplies } from "./byte-range";
import { vaultRefusalStatus } from "./vault-refusals";
import type { VaultService } from "./vault-service";

// a sandbox blanks WebKit's PDF viewer, so a PDF alone is served without one: its policy still
// runs no script and loads nothing but itself, and only this origin may frame it. every other kind
// is sandboxed, which is what makes an svg safe: <img> never runs its script, but a navigation to
// this url renders it as a document.
const PDF_POLICY =
  "default-src 'none'; object-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'";
const SANDBOX_POLICY = "default-src 'none'; sandbox";

const policyFor = (kind: AssetKind): string => (kind === "pdf" ? PDF_POLICY : SANDBOX_POLICY);

// RFC 5987's ext-value: what is not an attr-char is percent-encoded as UTF-8, so a name with a
// quote, a semicolon or a non-ASCII letter can neither end the header nor be misread
const ATTR_CHAR = /[A-Za-z0-9!#$&+.^_`|~-]/u;

const contentDisposition = (path: string): string => {
  const encoded = [...new TextEncoder().encode(basenamePath(path))]
    .map((byte) => {
      const char = String.fromCodePoint(byte);
      return byte < 0x80 && ATTR_CHAR.test(char)
        ? char
        : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    })
    .join("");
  return `inline; filename*=UTF-8''${encoded}`;
};

// no-cache with an etag: a re-mount revalidates instead of re-downloading.
const baseHeaders = (kind: AssetKind, path: string) => ({
  "accept-ranges": "bytes",
  "cache-control": "no-cache",
  "content-disposition": contentDisposition(path),
  "content-security-policy": policyFor(kind),
  "x-content-type-options": "nosniff",
});

export const handleVaultAsset = async (c: Context, vault: VaultService): Promise<Response> => {
  const query = vaultAssetQuerySchema.safeParse(c.req.query());
  if (!query.success) {
    return c.text("Bad request", 400);
  }
  const { path } = query.data;
  const mediaType = assetMediaType(path);
  const kind = assetKind(path);
  if (mediaType === null || kind === null) {
    return c.text(`${path} is not a file type this library serves`, 400);
  }
  const head = c.req.method === "HEAD";
  try {
    // stat before read: no-cache means every re-mount revalidates.
    const stat = await vault.statAsset(path);
    const headers = { ...baseHeaders(kind, stat.path), etag: stat.etag };
    // a ranged request is answered its range even when it also revalidates: a media loader
    // (WebKit's, AVFoundation's) sends the etag it holds with each range it reads, and a 304 to a
    // range leaves it holding only the probe's two bytes
    const ranged = c.req.header("range") !== undefined;
    if (!ranged && c.req.header("if-none-match") === stat.etag) {
      return new Response(null, { headers, status: 304 });
    }
    const asked = rangeApplies(c.req.header("if-range"), stat.etag)
      ? parseByteRange(c.req.header("range"), stat.size)
      : ({ kind: "whole" } as const);
    if (asked.kind === "unsatisfiable") {
      return new Response(null, {
        headers: { ...headers, "content-range": `bytes */${String(stat.size)}` },
        status: 416,
      });
    }
    const typed = { ...headers, "content-type": mediaType };
    if (asked.kind === "whole") {
      if (head) {
        return new Response(null, {
          headers: { ...typed, "content-length": String(stat.size) },
          status: 200,
        });
      }
      const asset = await vault.readBytes(path);
      return new Response(asset.bytes, { headers: { ...typed, etag: asset.etag }, status: 200 });
    }
    const span = { end: asked.end, start: asked.start };
    const length = span.end - span.start + 1;
    const partial = {
      ...typed,
      "content-length": String(length),
      "content-range": `bytes ${String(span.start)}-${String(span.end)}/${String(stat.size)}`,
    };
    if (head) {
      return new Response(null, { headers: partial, status: 206 });
    }
    const piece = await vault.readByteRange(path, span);
    // a file that changed between the stat and the read is answered as it now is, whole: the
    // range the client asked for names bytes of the version it no longer is
    if (piece.etag !== stat.etag || piece.bytes.byteLength !== length) {
      const asset = await vault.readBytes(path);
      return new Response(asset.bytes, { headers: { ...typed, etag: asset.etag }, status: 200 });
    }
    return new Response(piece.bytes, { headers: partial, status: 206 });
  } catch (error) {
    const status = vaultRefusalStatus(error);
    if (status === null) {
      throw error;
    }
    // raw Response: c.text wants a literal StatusCode and this status is a plain number.
    return new Response(error instanceof Error ? error.message : "Refused", { status });
  }
};
