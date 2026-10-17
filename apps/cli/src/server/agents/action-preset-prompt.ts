// a named action's prompt block, composed on the server like the view context's: the stored text
// stays what the person typed (or the preset's label), and the block is its own `text` element
// ahead of the context, never a prefix on their words.

import type { ActionPreset } from "@repo/domain/action-preset";

// what a session can rely on when a block names its tools: the CLI on the agent's PATH, and the
// library's own filing rules (its AGENTS.md) among the instructions
export interface PromptFacts {
  cli: boolean;
  filingRules: boolean;
}

export const TIDY_BATCH = 100;

const TIDY_OPENING =
  "Tidy the person's library: file and tag the items in Unsorted/ and the items with no tags.";

// the folder and the tags to choose, from the library's own rules or, without them, ours
const filingRulesLines = (facts: PromptFacts): string[] =>
  facts.filingRules
    ? [
        "- File each item into the folder the library's filing rules (its AGENTS.md, in your instructions above) name for it, preferring folders that already exist.",
      ]
    : [
        "- The library has no filing rules, so file by topic into the folders that already exist, and make a new folder only when five or more items belong in it.",
        "- Tag by topic, one to three tags, never by kind (a link, a PDF and an image are kinds, not topics).",
      ];

// the moves, through the CLI when the session holds it, else as the files themselves
const toolLines = (facts: PromptFacts): string[] =>
  facts.cli
    ? [
        "- Move an item with `inteligir vault rename <path> <folder>/<name>`, which rewrites the links to it.",
        "- Tag it with `inteligir tag add <tag> <path>`, reusing the tags `inteligir tags` lists before you make a new one.",
      ]
    : [
        "- Move an item by moving its file into the folder; keep its name.",
        "- Tag it in its frontmatter `tags` list, reusing the library's existing tags before you make a new one.",
      ];

const loopLines = (facts: PromptFacts): string[] => {
  const unsorted = facts.cli
    ? `\`inteligir items --folder Unsorted --limit ${TIDY_BATCH} --json\``
    : `the next ${TIDY_BATCH} files in Unsorted/`;
  const untagged = facts.cli
    ? `\`inteligir items --untagged --limit ${TIDY_BATCH} --json\``
    : `the next ${TIDY_BATCH} items with no tags`;
  return [
    `Work through all of them in this one run, in batches of ${TIDY_BATCH}: list a batch with ${unsorted} (then, once Unsorted is done, ${untagged}), file and tag every item in it, then say how far you are ("Filed 300 of 1,240") and go on with the next batch. Do not stop until none is left, or every one left is unclear.`,
    "End with a summary: how many items you filed, the folders you made, and the unclear ones by name (at most 20, then how many more).",
  ];
};

const composeTidyBlock = (facts: PromptFacts): string =>
  [
    TIDY_OPENING,
    "",
    ...filingRulesLines(facts),
    ...toolLines(facts),
    "- Judge an item by its url, site, description and the opening of its text.",
    "- Never change an item's text, title or url, and never delete anything.",
    "- Leave an item whose place is unclear where it is, and name it.",
    "",
    ...loopLines(facts),
  ].join("\n");

export const composePresetBlock = (preset: ActionPreset, facts: PromptFacts): string => {
  switch (preset) {
    case "tidy-library": {
      return composeTidyBlock(facts);
    }
    default: {
      const exhaustive: never = preset;
      return exhaustive;
    }
  }
};
