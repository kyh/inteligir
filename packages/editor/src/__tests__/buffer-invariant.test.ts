import { afterEach, describe, expect, test } from "vitest";
import { createMarkdownEditor, type MarkdownEditor } from "../create-markdown-editor";

// The live-preview stack decorates aggressively (hide/fold StateFields, the
// force-parse healer, measure-driven view plugins). None of that may ever
// touch the buffer: the buffer IS the file. This test drives seeded arbitrary
// edits through the full stack and mirrors them on a plain string — any
// extension mutating text outside the dispatched changes diverges the two.
// jsdom's zero geometry keeps soft-indent's pixel branch inert here; its
// refresh rounds only run against a real layout, so the browser demo covers
// them.

const initialDoc = `---
title: Invariant
tags: [a, b]
---

# Alpha

Some **bold**, _em_, \`code\`, ~~strike~~, a [link](https://example.com),
an escape \\* and dashes -- here.

> quote level one
> > nested quote

- item one
- [ ] task open
- [x] task done
1. ordered

***

\`\`\`js
const x = 1;
\`\`\`

Tail paragraph with enough text to edit into.
`;

const snippets = [
  "**",
  "_",
  "`",
  "~~",
  "# ",
  "- [ ] ",
  "> ",
  "---\n",
  "$",
  "\\*",
  "[x](y)",
  "\n\n",
  "plain words ",
  "<div>",
  "{{x}}",
];

// mulberry32: deterministic PRNG so a failure reproduces byte-for-byte.
const mulberry32 = (seed: number): (() => number) => {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

let editor: MarkdownEditor | undefined;
afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

describe("buffer == file", () => {
  test("120 seeded arbitrary edits never diverge from the string mirror", async () => {
    editor = createMarkdownEditor({ parent: document.body, doc: initialDoc });
    const random = mulberry32(0xa11ce);
    let mirror = initialDoc;
    let dispatched = 0;

    for (let i = 0; i < 120; i++) {
      const kind = random();
      const pos = Math.floor(random() * (mirror.length + 1));
      if (kind < 0.5) {
        const snippet = snippets[Math.floor(random() * snippets.length)] ?? "x";
        editor.view.dispatch({
          changes: { from: pos, insert: snippet },
          userEvent: "input.type",
        });
        mirror = mirror.slice(0, pos) + snippet + mirror.slice(pos);
      } else {
        const to = Math.min(mirror.length, pos + 1 + Math.floor(random() * 8));
        editor.view.dispatch({
          changes: { from: pos, to },
          userEvent: "delete",
        });
        mirror = mirror.slice(0, pos) + mirror.slice(to);
      }
      dispatched += 1;
      expect(editor.getDoc()).toBe(mirror);
    }
    expect(dispatched).toBe(120);

    // Let the deferred machinery settle (the healer's deferred passes, the
    // measure nudges) and confirm nothing touched the buffer afterwards.
    await new Promise((resolve) => {
      setTimeout(resolve, 120);
    });
    expect(editor.getDoc()).toBe(mirror);
  });

  test("interaction paths write only what they mean to", async () => {
    const docChanges: string[] = [];
    const openedLinks: string[] = [];
    editor = createMarkdownEditor({
      parent: document.body,
      doc: initialDoc,
      onDocChanged: (doc) => docChanges.push(doc.toString()),
      onOpenLink: (url) => openedLinks.push(url),
    });
    const view = editor.view;

    // Selection moves rebuild decorations; none of those rebuilds may write.
    for (const anchor of [0, 5, 40, 80, initialDoc.length]) {
      view.dispatch({ selection: { anchor } });
    }

    // A full pointer drag cycle: freeze, mid-drag selection, release nudge.
    view.contentDOM.dispatchEvent(new MouseEvent("pointerdown", { button: 0, bubbles: true }));
    view.dispatch({ selection: { anchor: 10 } });
    window.dispatchEvent(new MouseEvent("pointerup"));

    // Keymap traffic that only moves the selection (exercises the
    // reveal-block-on-arrow commands ahead of the defaults).
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));

    // Mousedown on a rendered link routes to onOpenLink, never the buffer.
    // (jsdom's zero geometry may make posAtCoords refuse the lookup, so the
    // callback itself is not asserted — the invariant under test is no write.)
    const link = view.contentDOM.querySelector(".cm-rendered-link");
    expect(link).not.toBeNull();
    link?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(openedLinks.length).toBeLessThanOrEqual(1);
    expect(docChanges).toEqual([]);
    expect(editor.getDoc()).toBe(initialDoc);

    // A checkbox click writes exactly its one character, and nothing else.
    const box = view.contentDOM.querySelector("input.cm-task-checkbox");
    expect(box).not.toBeNull();
    box?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const toggled = initialDoc.replace("- [ ] task open", "- [x] task open");
    expect(editor.getDoc()).toBe(toggled);
    expect(docChanges).toEqual([toggled]);

    // Flush the deferred machinery; still exactly the one deliberate write.
    await new Promise((resolve) => {
      setTimeout(resolve, 200);
    });
    expect(editor.getDoc()).toBe(toggled);
    expect(docChanges).toEqual([toggled]);
  });
});
