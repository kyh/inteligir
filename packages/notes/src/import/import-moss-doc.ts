// The one-shot Moss import for a single note: legacy comment syntax, the
// comment footer, whitespace-lax modern forms, moss-html fence headers. Pure
// over (body, sidecar) — the vault walk, locking and writes are the caller's.
// Idempotent: running it over its own output reports no changes.

import { COMMENT_ID_RE, type CommentSidecar } from "../comments/sidecar-schema";
import { extractCommentFooter, mergeFooterRows } from "./comment-footer";
import { migrateLegacyCommentMarkers } from "./legacy-comment-markers";
import { normalizeLaxMarkers, normalizeLaxTabs } from "./lax-forms";
import { normalizeMossHtmlHeaders } from "./moss-html-headers";

export type ImportDocReport = {
  /** Marker pairs rewritten to the modern form. */
  legacyMarkerPairs: number;
  /** Legacy edges left verbatim (no partner, or an empty id list). */
  unpairedLegacyMarkers: number;
  footer: "none" | "merged" | "malformed";
  footerRowsAdded: number;
  /** Footer rows dropped: id already in the sidecar, or an id the sidecar
   * grammar refuses. */
  footerRowsSkipped: number;
  laxMarkersNormalized: number;
  tabsNormalized: number;
  htmlHeadersNormalized: number;
  warnings: string[];
};

export type ImportDocResult = {
  body: string;
  sidecar: CommentSidecar;
  bodyChanged: boolean;
  sidecarChanged: boolean;
  report: ImportDocReport;
};

export function importMossDoc(raw: string, sidecar: CommentSidecar): ImportDocResult {
  const warnings: string[] = [];

  // Footer first: its bytes must not reach the marker passes as body text.
  const footer = extractCommentFooter(raw);
  let footerState: ImportDocReport["footer"] = "none";
  let footerRowsAdded = 0;
  let footerRowsSkipped = 0;
  let nextSidecar = sidecar;
  let body = footer.body;
  if (footer.kind === "malformed") {
    footerState = "malformed";
    warnings.push(`comment footer left in place: ${footer.error}`);
  } else if (footer.kind === "found") {
    footerState = "merged";
    const validRows: typeof footer.rows = {};
    for (const [id, entry] of Object.entries(footer.rows)) {
      if (COMMENT_ID_RE.test(id)) {
        validRows[id] = entry;
      } else {
        footerRowsSkipped++;
        warnings.push(`footer row "${id}" dropped: id outside the sidecar grammar`);
      }
    }
    const merged = mergeFooterRows(sidecar, validRows);
    nextSidecar = merged.sidecar;
    footerRowsAdded = merged.added;
    footerRowsSkipped += merged.skipped;
  }

  const markers = migrateLegacyCommentMarkers(body);
  body = markers.body;
  if (markers.unpaired > 0) {
    warnings.push(`${markers.unpaired} legacy comment marker(s) left verbatim: no partner`);
  }

  const lax = normalizeLaxMarkers(body);
  body = lax.body;
  const tabs = normalizeLaxTabs(body);
  body = tabs.body;
  const html = normalizeMossHtmlHeaders(body);
  body = html.body;

  return {
    body,
    sidecar: nextSidecar,
    bodyChanged: body !== raw,
    sidecarChanged: footerRowsAdded > 0,
    report: {
      legacyMarkerPairs: markers.migrated,
      unpairedLegacyMarkers: markers.unpaired,
      footer: footerState,
      footerRowsAdded,
      footerRowsSkipped,
      laxMarkersNormalized: lax.normalized,
      tabsNormalized: tabs.normalized,
      htmlHeadersNormalized: html.normalized,
      warnings,
    },
  };
}
