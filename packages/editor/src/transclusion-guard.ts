// Only the open item's own embeds expand, so the one cycle left to refuse is the item embedding
// itself: content inside an embed renders its embeds as chips and never recurses.

export type TransclusionDecision =
  | { kind: "chip"; reason: "unresolved" | "cycle" }
  | { kind: "render"; itemId: string };

export const decideTransclusion = (
  openItemId: string | null,
  resolved: string | null,
): TransclusionDecision => {
  if (resolved === null) {
    return { kind: "chip", reason: "unresolved" };
  }
  if (resolved === openItemId) {
    return { kind: "chip", reason: "cycle" };
  }
  return { itemId: resolved, kind: "render" };
};
