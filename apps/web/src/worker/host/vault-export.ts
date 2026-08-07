// ---------------------------------------------------------------------------
// `GET /v1/host/export` — the whole vault as one streamed zip.
//
// This is the promise "your notes are markdown you own" reduced to a route.
// With no folder on disk, a user who cannot get their bytes out does not own
// them, so the export is a first-class capability rather than a support task.
//
// It STREAMS end to end (../vault/zip-stream): one R2 body at a time, deflated
// and handed to the browser, with nothing gathered. A vault is allowed to be
// larger than the isolate, so the buffering version of this route would work in
// testing and fail for exactly the users who need it most.
//
// A GET, and a plain navigation rather than a fetch: the browser writes the
// body to disk as it arrives, which a `fetch` + blob would undo by materializing
// the archive in the page. That has one consequence worth naming — a top-level
// navigation carries NO `Origin`, so this leaf cannot derive a client class the
// way the ticket mint does and is gated on the session alone. What a cross-site
// page can therefore cause is a download the victim's browser saves and the
// page cannot read: no disclosure, only cost. That cost is what the leaf's rate
// budget (./host-limits) is for.
// ---------------------------------------------------------------------------

import { readCredential, verifyHostSession } from "./session";
import type { UserVault } from "./vault/user-vault";
import { MAX_ENTRIES, MAX_TOTAL_BYTES, zipStream, type ZipSource } from "./vault/zip-stream";

/**
 * Why an export cannot be served, when it cannot.
 *
 * Both are the classic zip format's ceilings, and both are decided from
 * manifest numbers BEFORE a byte is sent — which is the whole reason they are
 * modelled: a refusal the user reads is worth more than an archive that
 * truncates at 4 GiB and unzips to garbage.
 */
export type ExportRefusal =
  | { readonly reason: "too-large"; readonly totalBytes: number }
  | { readonly reason: "too-many"; readonly entries: number };

/** The archive plan, or the reason there is none. Pure over the manifest, so
 * the ceilings are testable without R2. */
export function planExport(
  files: readonly { readonly path: string; readonly size: number }[],
):
  | { readonly ok: true; readonly files: readonly string[] }
  | ({ readonly ok: false } & ExportRefusal) {
  if (files.length > MAX_ENTRIES) return { ok: false, reason: "too-many", entries: files.length };
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_TOTAL_BYTES) return { ok: false, reason: "too-large", totalBytes };
  return { ok: true, files: files.map((file) => file.path) };
}

/** The message a refusal answers with — one sentence, since it is read by a
 * person who just pressed a button. */
function refusalMessage(refusal: ExportRefusal): string {
  return refusal.reason === "too-many"
    ? `This vault has ${refusal.entries} files, more than a single zip can hold. Ask support to split the export.`
    : `This vault is ${Math.round(refusal.totalBytes / 1024 / 1024 / 1024)} GB, larger than a single zip can hold. Ask support to split the export.`;
}

/** The object's half: verify the credential against this object's own name,
 * then stream the archive. */
export async function handleVaultExport(
  request: Request,
  env: Env,
  vault: UserVault,
  hostName: string | undefined,
  now: () => Date,
): Promise<Response> {
  const credential = readCredential(request.headers);
  if (credential === null) return new Response("unauthorized", { status: 401 });
  const origin = new URL(request.url).origin;
  const session = await verifyHostSession(env, origin, credential, hostName);
  if (session === null) return new Response("unauthorized", { status: 401 });

  const plan = planExport(vault.liveFiles());
  if (!plan.ok) return new Response(refusalMessage(plan), { status: 413 });

  const sources: ZipSource[] = plan.files.map((path) => ({
    name: path,
    open: () => vault.openStream(path),
  }));
  return new Response(zipStream(sources, now), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${exportFileName(now())}"`,
      // The archive is built fresh per request and is one user's whole vault.
      "cache-control": "no-store",
    },
  });
}

function exportFileName(at: Date): string {
  return `inteligir-vault-${at.toISOString().slice(0, 10)}.zip`;
}
