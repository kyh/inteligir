// Moss's pre-sidecar comment store: a `<!--moss:comments {json} -->` HTML
// comment at the very end of the note. The import moves its rows into the
// sidecar and strips the footer bytes from the body. Two deliberate
// divergences from Moss's own reader: malformed JSON leaves the footer IN
// PLACE with a warning (Moss folds it to `{}` and strips anyway — data loss
// our malformed-sidecar rule exists to refuse), and timestamps are converted
// from Moss's milliseconds to the sidecar contract's Unix seconds.

import { z } from "zod";

import {
  commentSourceSchema,
  type CommentEntry,
  type CommentSidecar,
} from "../comments/sidecar-schema";
import { activeLineMask } from "../markdown/line-scan";

const FOOTER_MARKER = "<!--moss:comments\n";
const FOOTER_CLOSE = "\n-->";

// The footer's row shape (Moss's CommentMetadata): ms timestamps, an optional
// singular imageUrl beside the plural. Unknown fields pass through.
const footerEntrySchema = z.looseObject({
  text: z.string(),
  createdAt: z.number().finite(),
  updatedAt: z.number().finite(),
  source: commentSourceSchema.optional(),
  parentId: z.string().optional(),
  imageUrl: z.string().optional(),
  imageUrls: z.array(z.string()).optional(),
  resolvedAt: z.number().finite().optional(),
  resolvedBy: commentSourceSchema.optional(),
});
const footerSchema = z.record(z.string().min(1), footerEntrySchema);

/** A seconds timestamp today is ~1.8e9 and a milliseconds one ~1.8e12; the
 * gap is four centuries wide, so the threshold cannot misclassify real data. */
function toUnixSeconds(value: number): number {
  return value > 1e12 ? Math.floor(value / 1000) : value;
}

function toSidecarEntry(row: z.infer<typeof footerEntrySchema>): CommentEntry {
  const { imageUrl, imageUrls, createdAt, updatedAt, resolvedAt, ...rest } = row;
  const entry: CommentEntry = {
    ...rest,
    createdAt: toUnixSeconds(createdAt),
    updatedAt: toUnixSeconds(updatedAt),
  };
  if (resolvedAt !== undefined) entry.resolvedAt = toUnixSeconds(resolvedAt);
  const urls = [...(imageUrl === undefined ? [] : [imageUrl]), ...(imageUrls ?? [])];
  const deduped = [...new Set(urls)];
  if (deduped.length > 0) entry.imageUrls = deduped;
  return entry;
}

export type FooterExtraction =
  | { kind: "none"; body: string }
  | { kind: "malformed"; body: string; error: string }
  | { kind: "found"; body: string; rows: Record<string, CommentEntry> };

/**
 * Moss's own footer position rules: the LAST marker occurrence, a close after
 * it, nothing but whitespace beyond the close, and the newline before the
 * marker goes with it. On top of those, the marker line must sit outside any
 * code fence — a fenced example of the syntax is content, not a store.
 */
export function extractCommentFooter(md: string): FooterExtraction {
  const markerIndex = md.lastIndexOf(FOOTER_MARKER);
  if (markerIndex === -1) return { kind: "none", body: md };
  const closeIndex = md.indexOf(FOOTER_CLOSE, markerIndex + FOOTER_MARKER.length);
  if (closeIndex === -1) return { kind: "none", body: md };
  const closeEnd = closeIndex + FOOTER_CLOSE.length;
  if (md.slice(closeEnd).trim().length > 0) return { kind: "none", body: md };

  const markerLine = md.slice(0, markerIndex).split("\n").length - 1;
  const lines = md.split("\n");
  if (activeLineMask(lines)[markerLine] !== true) return { kind: "none", body: md };

  const strippedStart =
    markerIndex > 0 && md.charCodeAt(markerIndex - 1) === 10 ? markerIndex - 1 : markerIndex;
  const body = md.slice(0, strippedStart);
  const jsonText = md.slice(markerIndex + FOOTER_MARKER.length, closeIndex);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    return {
      kind: "malformed",
      body: md,
      error: error instanceof Error ? error.message : "footer is not JSON",
    };
  }
  const result = footerSchema.safeParse(parsed);
  if (!result.success) {
    return {
      kind: "malformed",
      body: md,
      error: result.error.issues[0]?.message ?? "footer rows are not Moss's shape",
    };
  }
  const rows: Record<string, CommentEntry> = {};
  for (const [id, row] of Object.entries(result.data)) {
    rows[id] = toSidecarEntry(row);
  }
  return { kind: "found", body, rows };
}

export type FooterMerge = { sidecar: CommentSidecar; added: number; skipped: number };

/** Fold footer rows into the sidecar. An id the sidecar already holds keeps
 * the sidecar's row — the sidecar is the live store and the footer is the
 * stale copy a partial earlier migration left behind. */
export function mergeFooterRows(
  sidecar: CommentSidecar,
  rows: Record<string, CommentEntry>,
): FooterMerge {
  const merged: CommentSidecar = { ...sidecar };
  let added = 0;
  let skipped = 0;
  for (const [id, entry] of Object.entries(rows)) {
    if (id in merged) {
      skipped++;
      continue;
    }
    merged[id] = entry;
    added++;
  }
  return { sidecar: merged, added, skipped };
}
