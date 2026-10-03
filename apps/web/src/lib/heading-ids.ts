// a heading's id is the anchor GitHub gives the same heading, so a doc's own `(#anchor)` links,
// the privacy policy's index among them, land on it here and wherever GitHub renders the file

// hast as far as this walk reads it: react-markdown hands a rehype plugin its tree untyped
type HastPropertyValue =
  | boolean
  | number
  | string
  | null
  | undefined
  | readonly (number | string)[];

interface HastNode {
  readonly type: string;
  readonly tagName?: string;
  readonly value?: string;
  readonly properties?: Readonly<Record<string, HastPropertyValue>>;
  readonly children?: readonly HastNode[];
}

const HEADING = /^h[1-6]$/u;

/** GitHub's rule: lowercase, punctuation and symbols dropped, each space a dash. */
export const headingSlug = (text: string): string =>
  text
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
    .replaceAll(" ", "-");

const textOf = (node: HastNode): string =>
  node.type === "text" ? (node.value ?? "") : (node.children ?? []).map(textOf).join("");

// GitHub's rule for a repeat: the slug's next free `-1`, `-2`, … in document order
const claimId = (taken: Map<string, number>, slug: string): string => {
  let id = slug;
  while (taken.has(id)) {
    const repeats = (taken.get(slug) ?? 0) + 1;
    taken.set(slug, repeats);
    id = `${slug}-${repeats}`;
  }
  taken.set(id, 0);
  return id;
};

/** A rehype plugin giving every heading GitHub's id, counted afresh for each document. */
export const rehypeHeadingIds =
  () =>
  (tree: HastNode): HastNode => {
    const taken = new Map<string, number>();
    const withIds = (node: HastNode): HastNode => {
      if (node.type === "element" && HEADING.test(node.tagName ?? "")) {
        const id = claimId(taken, headingSlug(textOf(node)));
        return { ...node, properties: { ...node.properties, id } };
      }
      return node.children === undefined ? node : { ...node, children: node.children.map(withIds) };
    };
    return withIds(tree);
  };
