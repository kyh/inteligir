// No imports, on purpose: the contract's link rows validate against this, and it must not load
// the markdown parser behind the scan to do it.

export const LINK_KINDS = ["wiki", "md", "image"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];
