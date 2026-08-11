import type { AssetUpload } from "@repo/bridge/client";
import { isRecord } from "@repo/bridge/wire-helpers";

// ---------------------------------------------------------------------------
// `POST /v1/host/assets` from the page — the streaming half of attachment
// ingestion, for the files a socket frame cannot carry.
//
// A same-origin POST, so the browser attaches the session cookie and an
// `Origin` the host recognizes: exactly the pair that makes this the `web`
// class, and the same one the ticket mint is admitted on. The `File` goes
// straight to `fetch` as the body, so the bytes leave the page as a stream and
// reach R2 as one — neither this page nor the object ever holds them whole.
//
// `dir` and `name` ride in the query because that is where the route reads
// them; both are sanitized host-side, which is the only place that decides
// where an asset may land.
// ---------------------------------------------------------------------------

export const uploadHostAsset: AssetUpload = async ({ dir, name, body }) => {
  const query = new URLSearchParams({ dir, name });
  const response = await fetch(`/v1/host/assets?${query}`, { method: "POST", body });
  if (!response.ok) throw new Error(refusal(response.status));
  const answered: unknown = await response.json().catch(() => null);
  const path = isRecord(answered) ? answered.path : undefined;
  // The path is what the caller inserts into the document. A missing one would
  // otherwise become an image node pointing at nothing.
  if (typeof path !== "string" || path === "") throw new Error("the host answered no path");
  return { path };
};

/** What a refusing status means, in a sentence a toast can end with. */
function refusal(status: number): string {
  if (status === 413) return "it is larger than this host accepts";
  if (status === 401 || status === 403) return "your session cannot upload here";
  return `the host answered ${status}`;
}
