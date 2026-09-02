// the editor root is depth 0 (embeds expand); content inside a transclusion is depth 1+,
// where embeds stay chips.

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

export function nestedScope(scope: TransclusionScope, resolved: string): TransclusionScope {
  return { depth: scope.depth + 1, chain: [...scope.chain, resolved] };
}
