// The editor's asset seam, filled in for THIS host: an image `src` with no
// scheme is a VAULT-relative path, and the vault serves its bytes on
// `/vault/asset`.
//
// Vault-relative, not note-relative, and that is a decision rather than a
// simplification: note-relative would make the same `![](diagram.png)` mean
// different files in two notes, so moving a note would silently repoint its
// pictures. One path, one file — the same rule wiki-links resolve under.
//
// Traversal is refused HERE as well as on the wire. The server's own
// containment is what actually holds (it realpaths and refuses symlinks), but
// a `../` that reaches the network at all is a request nobody meant to send.

import { apiPath, apiRoutes } from "@repo/server-contract/routes";

/** The URL for a vault-relative image path, or null when the path is not one
 *  this vault can serve. */
export function vaultAssetUrl(src: string): string | null {
  // Markdown URLs are commonly percent-encoded (spaces above all), and the
  // vault path is the DECODED one. A malformed escape is taken literally —
  // the server will refuse it if it is not a real path.
  let path: string;
  try {
    path = decodeURIComponent(src);
  } catch {
    path = src;
  }
  path = path.replace(/^(?:\.\/)+/, "").replace(/^\/+/, "");
  if (path === "" || path === ".." || path.startsWith("../") || path.includes("/../")) {
    return null;
  }
  return `${apiPath(apiRoutes.vault.asset)}?path=${encodeURIComponent(path)}`;
}
