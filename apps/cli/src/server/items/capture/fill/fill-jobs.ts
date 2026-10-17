// one job of the fill worker: a page's html in, its facts and its article out, with no network in
// reach. The article is written as the editor's own fixpoint, so an item opens rich and its first
// edit is a minimal diff.

import type { DocAnalysis } from "@repo/editor/markdown/markdown-doc";

export interface FillJob {
  id: string;
  url: string;
  html: string;
}

export type FillJobResult =
  // `analysis`: what the editor's gate made of the article the body ladder kept
  | { kind: "filled"; id: string; article: string; analysis: DocAnalysis }
  | { kind: "failed"; id: string; reason: string };

// PIVOT-STUB(S1): replaced by linkedom, defuddle, the page's meta, turndown and the body ladder (§4.4 point 4)
export const runFillJob = (job: FillJob): FillJobResult => ({
  id: job.id,
  kind: "failed",
  reason: "PIVOT-STUB(S1)",
});
