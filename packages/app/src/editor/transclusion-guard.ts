// Pure guard policy for ![[transclusion]] rendering — React-free so the
// depth/cycle semantics are pinned by unit tests. The editor root renders at
// depth 0 (embeds expand); content rendered INSIDE a transclusion carries
// depth 1+, where embeds stay chips. `chain` is the ancestor path list.

export type TransclusionScope = { depth: number; chain: readonly string[] };

export type TransclusionDecision =
  | { kind: "chip"; reason: "unresolved" | "depth" | "cycle" }
  | { kind: "render"; path: string };

export function decideTransclusion(
  scope: TransclusionScope,
  resolved: string | null,
): TransclusionDecision {
  if (resolved === null) return { kind: "chip", reason: "unresolved" };
  if (scope.depth >= 1) return { kind: "chip", reason: "depth" };
  if (scope.chain.includes(resolved)) return { kind: "chip", reason: "cycle" };
  return { kind: "render", path: resolved };
}

/** The scope the rendered target's own content is evaluated under. */
export function nestedScope(scope: TransclusionScope, resolved: string): TransclusionScope {
  return { depth: scope.depth + 1, chain: [...scope.chain, resolved] };
}
