---
name: add-editor-node
description: Add a node type to the Plate editor — the Base + React kit pair, the base-kit composition, the Slate↔mdast rule, the MDX vocabulary gate in @repo/notes, an insert surface, and the byte-pinned round-trip fixtures that prove it. Use when a new block or inline needs to render and, above all, survive a save byte-for-byte.
allowed-tools: Bash(*), Read, Edit, Write
---

# Add an editor node type

Notes are markdown on disk. A node type is therefore not a component — it is a
**byte contract**: parse → Slate → serialize must land on the same bytes, and
must be idempotent. Get this wrong and a user's file silently reflows (or a
block silently disappears) on the first autosave.

Two editors exist and must stay identical: the headless mirror (`BASE_KIT`,
which the parse/serialize gate builds) and the live editor (`EDITOR_KIT`). Both
are composed from the SAME kit files, one exporting both halves. `kit-parity`
turns that premise into CI.

## Read first

- `apps/desktop/src/renderer/editor/kits/base-kit.ts` and `editor-kit.ts` — the
  two compositions and the comments explaining why they mirror.
- `apps/desktop/src/renderer/editor/markdown/md-rules.ts` — the header's rule
  dispatch note: **deserialize routes by mdast type (JSX by tag name), serialize
  by the Slate node's plugin key.** That asymmetry explains half the file.
- `packages/notes/src/markdown/vocabulary.ts` — the whole gate, ~100 lines.
- `apps/desktop/src/renderer/__tests__/markdown-roundtrip.test.ts` — the fixture
  matrix contract, stated at the top of the file.
- CLAUDE.md § "UI — one fixed workspace" for where the pipeline sits.

## Decide first: does the node have bytes, and in what syntax?

- **MDX component** (`<toggle>`, `<column_group>`, `<video>`, `<date>`) — the
  normal case. Needs a vocabulary allowlist entry and usually an `MD_RULES`
  rule.
- **Standard markdown / GFM** (headings, tables, task items) — remark already
  parses it; you need a kit and possibly a serialize override, no vocabulary
  change.
- **Custom inline syntax** (`[[wiki-links]]`) — needs a remark micromark
  extension in `packages/notes/src/markdown/` plus a slot in
  `MD_REMARK_PLUGINS` (`md-plugins.ts`, where **plugin order is load-bearing**
  and pinned by the fixtures).
- **Render-only, never serialized** (the `#tag` chips) — a decoration, no Base
  half at all. `TagChipKit` is the precedent; it is deliberately absent from
  `BASE_KIT` because a leaf decoration never reaches the value.

The vocabulary is a LOCKED list. Adding a tag to it means every vault file
containing that tag now opens Rich instead of Raw — a one-way promise that the
pipeline can represent it losslessly. Do not add one casually.

## Files to touch

Worked example: `date` (an inline void with a deserialize-only rule and a flow
edge case) and `callout` / `toggle` (MDX flow blocks).

### 1. The kit — `editor/kits/<name>-kit.tsx`

One file, both halves. The Base half is headless; the React half is the SAME
plugin `.withComponent(...)`, so metadata cannot diverge:

```ts
export const CalloutBaseKit = [CalloutBasePlugin];

export const CalloutKit = [CalloutBasePlugin.withComponent(CalloutElement)];
```

For a node Plate already ships, import both halves from the package:

```ts
export const DateBaseKit = [BaseDatePlugin];
export const DateKit = [DatePlugin.withComponent(DateElement)];
```

For a bespoke one, `createSlatePlugin` — and **register `isInline` / `isVoid`
if it is one**. A missing registration lets Slate normalization DELETE the node
from a canonical file on first edit; `kit-parity` asserts it explicitly:

```ts
const wikiLinkBasePlugin = createSlatePlugin({
  key: "wikiLink",
  node: { isElement: true, isInline: true, isVoid: true },
});
```

Live-editor-only behavior (input rules, `overrideEditor` transforms, the
`normalizeNode` that repairs a parsed shape) belongs on the React half ONLY —
the headless gate must never normalize, or a file's bytes change just by being
opened. `toggle-kit.tsx` states this in its `normalizeNode` comment.

### 2. The component — `editor/nodes/<name>-node.tsx`

A `PlateElement` wrapper reading attributes off `props.element` with `typeof`
narrows (the repo bans `as`):

```tsx
export function CalloutElement(props: PlateElementProps) {
  const variant =
    typeof props.element.variant === "string" ? props.element.variant.toLowerCase() : "";
```

**Never import vault-context, the open-note store, or transclusion eagerly from
a kit or its component.** `base-kit.ts` composes the kits, so an eager reach-back
closes an import cycle whose failure mode is an `undefined` kit export at module
init. Use `React.lazy(() => import(...))` — `wiki-link-kit.tsx` is the pattern —
and `apps/desktop/src/__tests__/editor-import-cycles.test.ts` enforces it (oxlint
and knip do not detect cycles).

### 3. Compose — `base-kit.ts` AND `editor-kit.ts`

Add the Base half to `BASE_KIT`, the React half to `EDITOR_KIT`, in the same
relative position. `EDITOR_KIT` must stay a plugin SUPERSET of `BASE_KIT`;
`kit-parity` fails on drift, and if the node is part of the MDX vocabulary its
plugin key must also join `VOCABULARY_PLUGIN_KEYS` in that test.

### 4. The markdown rule — `editor/markdown/md-rules.ts`

Only if the node has bytes. Check whether `@platejs/markdown`'s `defaultRules`
already handles it: `column`, `column_group`, `date`, `equation`,
`inline_equation` are free from defaults (fixture-test them, do NOT redefine).
Some defaults are wrong for this repo and get wrapped with delegation (`a`,
`table`, `blockquote`), and some ship a type-table entry with no rule at all:

```ts
  // Plate maps `toggle` in its type table but ships NO rule — serializing a
  // toggle without this one silently DROPS the block (probe-proven).
  toggle: {
    deserialize: (node, deco, options) => ({
      children: convertChildrenDeserialize(node.children, deco, options),
      type: "toggle",
      ...parseAttributes(node.attributes),
    }),
    serialize: (node, options) => jsxFlowSerialize(node, options, { name: "toggle" }),
  },
```

A rule may be one-directional. `date` overrides deserialize only, because the
default serializer's `<date value="…" />` on its own line re-parses as a FLOW
element and must be wrapped back into a paragraph to round-trip:

```ts
const chip: TElement = defaultDateDeserialize(node, deco, options);
if (node.type !== "mdxJsxFlowElement") return chip;
return { children: [{ text: "" }, chip, { text: "" }], type: "p" };
```

Pull every `defaultRules` handler you delegate to into a module-level const with
a throw if it is missing — that is how a `@platejs/markdown` bump fails loudly at
import instead of silently corrupting files.

### 5. The vocabulary gate — `packages/notes/src/markdown/vocabulary.ts`

MDX nodes only. Anything outside this scan sends the whole file to Raw mode
rather than being mangled — that is the safety property, so widening it is the
risky direction.

```ts
const ALLOWED_FLOW_TAGS = new Set([
  "callout",
  "toggle",
  "column_group",
  "column",
  "video",
  "media_embed",
  "file",
  "date",
]);
const ALLOWED_TEXT_TAGS = new Set(["date"]);
```

Attributes are gated too. Unknown attribute NAMES are fine on flow tags (their
rules spread string props both directions), but the value must be a plain string
`mdxJsxAttribute` — bare booleans, braced expressions and spreads do not survive
`parseAttributes`/`propsToAttributes`. If your rule DROPS unknown attributes the
way Plate's `date` rule does, add a per-tag allowlist like `DATE_ATTRS`;
otherwise the first rich save deletes user content.

### 6. An insert surface

Slash menu entries live in `GROUPS` in `editor/slash-menu.tsx`; the insert
transform belongs in the kit file next to the node it builds
(`insertDate`, `insertToggle`, `insertColumnGroup`). Inline voids go in via
`insertVoidAndEscape` (`editor/insert-void.ts`) so the caret can escape:

```ts
export function insertDate(editor: PlateEditor): void {
  const iso = formatIsoDate(new Date());
  insertVoidAndEscape(editor, { children: [{ text: "" }], date: iso, type: KEYS.date });
  editor.tf.insertText(" ");
}
```

Block menu / turn-into and the floating toolbar are separate surfaces — wire
only the ones the node actually needs.

### 7. Fixtures — `apps/desktop/src/renderer/__tests__/fixtures/roundtrip/`

**Their bytes ARE the test contract** (trailing spaces, indentation, line
endings). oxfmt ignores the directory (`.oxfmtrc.json` `ignorePatterns`) and so
must you — formatting them is corruption, and so is hand-typing them.

Three classes, one file per behavior:

| dir          | shape                | asserts                                                                              |
| ------------ | -------------------- | ------------------------------------------------------------------------------------ |
| `canonical/` | `<name>.md`          | `roundTrip(src) === src` (mod trailing newline), idempotent, `canonical && richSafe` |
| `churn/`     | `<stem>.{in,out}.md` | `roundTrip(in) === out` and `roundTrip(out) === out`                                 |
| `raw/`       | `<name>.<kind>.md`   | `richSafe === false`, `rawReason.kind` = the filename's second-to-last segment       |

Generate the bytes through the pipeline (`roundTrip` / `toCanonical` from
`editor/markdown/markdown-doc.ts`), never by hand. Add at least a canonical
fixture for the node's happy form, and — if the node has an empty or degenerate
state — a churn pair proving normalization settles. Read the `column` rule's
comment in `md-rules.ts` for the shape of that trap: an empty column that
serialized as expanded blank content re-parsed to zero children and re-emitted
self-closed, a non-idempotent first pass that knocks the file to Raw on the
next autosave.

`canonical/kitchen-sink.md` is also the dev harness's full-vocabulary sample
note (`fixture-bridge.ts` imports it) — a vocabulary addition belongs there so
the harness exercises it.

## Rules

- A serializer change that reshapes ANY byte of a canonical fixture is a
  regression. Fix the serializer; re-pin the fixture only as a conscious
  canonical-form revision, said out loud in the commit.
- `deserializeMd` from `@platejs/markdown` is BANNED in app code — its regex
  `htmlToJsx` pre-pass is fence-unaware and rewrites HTML inside fenced blocks.
  Parse through `parseMdast` + `scanVocabulary` + `mdastToSlate`
  (`markdown-kit.ts` replaces the stock paste parser for this reason).
- Transient state (AI marks, combobox inputs, open/collapsed) never touches the
  node or the bytes. `toggle`'s open state lives in the plugin's `openIds`
  store precisely so a collapse cannot dirty the document.
- Single-dollar math stays OFF and thematic breaks never emit `---` at byte 0 —
  both are locked decisions in `md-plugins.ts`. Don't relitigate them from a
  node's convenience.
- Files stay `.md`. The vocabulary is fixed; unknown JSX, expressions and HTML
  comments go to Raw by design, not by omission.

## Verify

```bash
pnpm --filter @repo/desktop test    # the whole pipeline: fixtures, parity, adversarial, corpus
pnpm --filter @repo/notes test      # vocabulary + remark stack, if you touched packages/notes
pnpm --filter @repo/desktop typecheck
```

The desktop suite is the gate. What each part catches:

- `__tests__/markdown-roundtrip.test.ts` — the canonical/churn/raw matrix.
- `__tests__/kit-parity.test.ts` — shared `MarkdownPlugin` by reference, the
  vocabulary plugin keys present in BOTH kits, `EDITOR_KIT ⊇ BASE_KIT`, and
  inline/void metadata agreeing element-by-element over the corpus.
- `__tests__/markdown-fixpoint.test.ts`, `markdown-roundtrip-property.test.ts`,
  `markdown-adversarial.test.ts` — generated and hostile inputs; a new node
  reaches them for free.
- `__tests__/markdown-corpus.test.ts` — real markdown from this repo plus every
  harness sample note, each pinned to an explicit expected classification, so a
  pipeline change that moves a file between classes is a red diff.
- `__tests__/editor-kits.test.ts` — the live-editor transforms (insert,
  normalize) that feed serialization.
- `src/__tests__/editor-import-cycles.test.ts` — no eager cycle around the kits.

Then drive it, because passing tests are not feature-correct:

```bash
pnpm --filter @repo/desktop dev:harness    # localhost:5173
```

Insert the node from its surface, type around it, and **toggle Raw mode** to
read the bytes back — the byte-stability invariant is the thing UI regressions
break. Reload to confirm the saved bytes re-open Rich, not Raw.

Before committing: `pnpm format:fix && pnpm verify` (format FIRST — a
`format:fix` after green gates rewrites the byte-pinned fixtures and ships red).
