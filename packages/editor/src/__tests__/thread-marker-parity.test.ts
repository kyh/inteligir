// The editor reads markers off its own Lezer tree (../thread-marker-nodes)
// while the vault reads them off the remark scan (@repo/notes). Two answers to
// one question need a pinned relationship, and this is it: equality over every
// shape the product produces, and CONTAINMENT — editor ⊆ vault — everywhere
// else, so the editor can only ever decline to chip an anchor, never chip a
// span the vault does not consider one.

import {
  findThreadMarkers,
  insertThreadMarker,
  threadMarkerText,
} from "@repo/notes/markdown/thread-marker";
import { describe, expect, test } from "vitest";
import { threadMarkerNodes } from "../thread-marker-nodes";
import { stateWithStack } from "./helpers";

const ANC = "anc_0123456789ab";
const OTHER = "anc_ffffffffffff";
const MARKER = threadMarkerText(ANC);

/** Both answers over the SAME bytes: CodeMirror normalizes CRLF when it builds
 *  the buffer, so the scan has to read the buffer's text, not the fixture's. */
const bothAnswers = (doc: string) => {
  const state = stateWithStack(doc);
  return { editor: threadMarkerNodes(state), scan: findThreadMarkers(state.doc.toString()) };
};

/** Every document shape the delegation surface can produce or has to survive. */
const AGREED: Record<string, string> = {
  "alone after a paragraph": `# Doc\n\nA paragraph.\n${MARKER}\n\n- [ ] a task\n`,
  "interrupting a paragraph": `Some text\n${MARKER}\n`,
  "inside a blockquote": `> quoted\n> ${MARKER}\n`,
  "inside a list item": `- item\n  ${MARKER}\n`,
  "after frontmatter": `---\ntitle: x\n---\n\n${MARKER}\n`,
  "two markers": `Para.\n\n${threadMarkerText(OTHER)}\n\nOther para.\n${MARKER}\n`,
  "CRLF document": `Para.\r\n\r\n${MARKER}\r\n`,
  "inside a fence": `Para.\n\n\`\`\`md\n${MARKER}\n\`\`\`\n`,
  "inside inline code": `Write \`${MARKER}\` to anchor.\n`,
  "inside a frontmatter string": `---\nnote: "${MARKER}"\n---\n\nBody.\n`,
  "mid-sentence": `Text ${MARKER} more text.\n`,
  "after a list marker": `- ${MARKER}\n`,
  "in a table cell": `| a | b |\n| - | - |\n| ${MARKER} | x |\n`,
  "malformed anchor": `<!-- inteligir:thread anc_NOTHEX0000 -->\n`,
  "no marker at all": `# Doc\n\nJust prose, a \`code span\` and a [link](https://x.test).\n`,
};

describe("the editor's tree answer agrees with the vault's scan", () => {
  for (const [name, doc] of Object.entries(AGREED)) {
    test(name, () => {
      const { editor, scan } = bothAnswers(doc);
      expect(editor).toEqual(scan);
    });
  }

  test("every insertion point the product can pick", () => {
    const source = `---\ntitle: t\n---\n\n# Head\n\nPara one.\n\n- a\n  - nested\n- b\n\n> quoted\n\n\`\`\`ts\ncode\n\`\`\`\n\nTail.\n`;
    for (let offset = 0; offset <= source.length; offset += 1) {
      const { editor, scan } = bothAnswers(insertThreadMarker(source, offset, ANC));
      expect(editor).toEqual(scan);
    }
  });
});

// Where the grammars part company, both differences run the same way: lezer
// keeps a CommonMark construct the scan disables, so it sees code where the
// scan sees a comment. Pinned as facts rather than left to be rediscovered.
describe("where they differ, the editor answers with strictly fewer markers", () => {
  const DIVERGENT: Record<string, string> = {
    "four-space indented (lezer parses codeIndented, the scan does not)": `Para.\n\n    ${MARKER}\n`,
    "inside a flow HTML block (lezer parses htmlFlow, the scan does not)": `<div>\n${MARKER}\n</div>\n`,
  };

  for (const [name, doc] of Object.entries(DIVERGENT)) {
    test(name, () => {
      const { editor, scan } = bothAnswers(doc);
      expect(scan).toHaveLength(1);
      expect(editor).toEqual([]);
    });
  }

  test("containment holds across the whole corpus", () => {
    for (const doc of [...Object.values(AGREED), ...Object.values(DIVERGENT)]) {
      const { editor, scan } = bothAnswers(doc);
      for (const marker of editor) {
        expect(scan).toContainEqual(marker);
      }
    }
  });
});
