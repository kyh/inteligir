// Only the open note's own embeds expand, so the one cycle left to refuse is the note embedding
// itself: content inside an embed renders its embeds as chips and never recurses.

export type TransclusionDecision =
  | { kind: "chip"; reason: "unresolved" | "cycle" }
  | { kind: "render"; path: string };

export const decideTransclusion = (
  hostPath: string | null,
  resolved: string | null,
): TransclusionDecision => {
  if (resolved === null) {
    return { kind: "chip", reason: "unresolved" };
  }
  if (resolved === hostPath) {
    return { kind: "chip", reason: "cycle" };
  }
  return { kind: "render", path: resolved };
};
