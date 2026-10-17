// a kept copy of a saved page, on a route of its own: its policy is a script-less sandbox the asset
// route's is not, and the viewer frames it by its url, never as a srcdoc.

import { vaultAssetQuerySchema } from "@repo/contract/local/routes";
import { PAGES_DIR } from "@repo/notes/items/item-kind";
import { extnamePath, parseVaultPath } from "@repo/notes/knowledge/vault-path";
import type { Context } from "hono";
import { vaultRefusalStatus } from "./vault-refusals";
import type { VaultService } from "./vault-service";

// the copy is a stranger's page: the sandbox runs none of its script and gives it no origin, and
// what it may load is only what it carries inline, so opening it makes no request and leaks no
// visit. no-referrer: a link it holds, followed, names nothing of this server.
const PAGE_COPY_HEADERS = {
  "cache-control": "no-cache",
  "content-security-policy":
    "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:",
  "content-type": "text/html; charset=utf-8",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

// an .html file directly under the page copies' folder: no other html in the library is served,
// since a note's folder may hold any page a hostile sync wrote
const isPageCopyPath = (path: string): boolean => {
  const prefix = `${PAGES_DIR}/`;
  if (!path.startsWith(prefix) || extnamePath(path) !== ".html") {
    return false;
  }
  const name = path.slice(prefix.length);
  return name.length > ".html".length && !name.includes("/");
};

export const handlePageCopy = async (c: Context, vault: VaultService): Promise<Response> => {
  const query = vaultAssetQuerySchema.safeParse(c.req.query());
  const parsed = query.success ? parseVaultPath(query.data.path) : null;
  if (parsed === null || !parsed.ok) {
    return c.text("Bad request", 400);
  }
  if (!isPageCopyPath(parsed.path)) {
    return c.text(`${parsed.path} is not a copy of a page`, 400);
  }
  try {
    const { etag } = await vault.statAsset(parsed.path);
    if (c.req.header("if-none-match") === etag) {
      return new Response(null, { headers: { ...PAGE_COPY_HEADERS, etag }, status: 304 });
    }
    const copy = await vault.readBytes(parsed.path);
    return new Response(c.req.method === "HEAD" ? null : copy.bytes, {
      headers: { ...PAGE_COPY_HEADERS, etag: copy.etag },
      status: 200,
    });
  } catch (error) {
    const status = vaultRefusalStatus(error);
    if (status === null) {
      throw error;
    }
    return new Response(error instanceof Error ? error.message : "Refused", { status });
  }
};
