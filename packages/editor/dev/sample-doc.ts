export const sampleDoc = `---
title: Live preview sample
tags: [editor, live-preview]
---

# The buffer is the file

Every construct below is plain markdown — click into any of them and the
syntax marks reveal themselves; move away and they hide again.

## Inline marks

Some **bold text**, some _emphasis_, some \`inline code\`,
~~struck through~~, an escape \\*not emphasis\\*, and a
[markdown link](https://codemirror.net) beside a bare URL
https://example.com — plus en--dash and em---dash folding.

## Tags

Prose carrying #alpha, #nested/child and #writing — click one and the host app
seeds its search with \`tag:<name>\`. Inside \`#code\` or a [labelled
#link](https://example.com/#frag) a hash is literal text, so no chip appears.

## Lists and tasks

- A plain bullet item
- Another, with **bold** inside
  - Nested bullet
1. An ordered item
2. A second one

- [ ] An open task — click the checkbox
- [x] A finished task
- [ ] Tasks toggle with a one-character edit

## Quotes

> A blockquote keeps its bar while the \`>\` marks fade.
> > Nesting draws a second bar.

## Callouts

> [!NOTE] A note with a title
> The header token folds to the label on the left; click into it and the
> \`[!NOTE]\` bytes come back while the box stays.

> [!WARNING]
> A callout needs no title.

> [!totally-made-up] An unknown type still gets a box and its own label.

## Math

Inline math like $e^{i\\pi} + 1 = 0$ sits in the line; a display block gets
its own:

$$
\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}
$$

A padded $ span like this $ is not math, an escaped \\$5 is a price, and a
broken $\\frobnicate{x}$ shows its own source plus the reason.

## Code

\`\`\`ts
interface Vault {
  path: string;
  files: Map<string, Uint8Array>;
}

export const open = (path: string): Vault => ({
  path,
  files: new Map(),
});
\`\`\`

\`\`\`python
def fib(n: int) -> int:
    return n if n < 2 else fib(n - 1) + fib(n - 2)
\`\`\`

---

A horizontal rule above, rendered as a rule until you touch it. Long
paragraphs wrap with a hanging indent on lists and quotes, so the markdown
prefix hangs in the margin the way headings hang their hashes.
`;
