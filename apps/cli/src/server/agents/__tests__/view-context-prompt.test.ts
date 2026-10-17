import type { LibraryViewContext, ViewContext } from "@repo/domain/view-context";
import { describe, expect, it } from "vitest";
import { composePresetBlock, TIDY_BATCH } from "../action-preset-prompt";
import type { PromptFacts } from "../action-preset-prompt";
import {
  composeContextPathsBlock,
  composeViewContextBlock,
  turnPromptInput,
} from "../view-context-prompt";

const REVISION = "b".repeat(64);
const NO_FACTS: PromptFacts = { cli: false, filingRules: false };
const ALL_FACTS: PromptFacts = { cli: true, filingRules: true };

const docContext = (): ViewContext => ({
  resource: "Notes/Plans.md",
  revision: REVISION,
  surface: "doc",
});

const libraryContext = (overrides: Partial<LibraryViewContext> = {}): LibraryViewContext => ({
  paths: [],
  scope: { kind: "all" },
  selected: 0,
  surface: "library",
  ...overrides,
});

describe("composeViewContextBlock", () => {
  it("names the file and the revision", () => {
    expect(composeViewContextBlock(docContext(), NO_FACTS)).toBe(
      `The user sent this while looking at Notes/Plans.md in the editor — "this", "here" and "the note" refer to that file. It hashed to sha-256 ${REVISION} when they sent it; if it no longer does, it changed afterwards.`,
    );
  });

  it("names a library view with nothing selected as every item it shows", () => {
    expect(composeViewContextBlock(libraryContext(), NO_FACTS)).toBe(
      [
        "The person sent this from their library, looking at everything.",
        "Nothing was selected, so 'these', 'this' and 'the selection' mean every item that view shows.",
      ].join("\n"),
    );
  });

  it("names the selection by path, in a folder, a kind and a search", () => {
    expect(
      composeViewContextBlock(
        libraryContext({
          kinds: ["link", "pdf"],
          paths: ["Reading/A.md", "Reading/B.md"],
          q: "lemon",
          scope: { kind: "folder", path: "Reading" },
          selected: 2,
        }),
        NO_FACTS,
      ),
    ).toBe(
      [
        "The person sent this from their library, looking at the folder Reading, only links and PDFs, filtered by “lemon”.",
        "'These', 'this' and 'the selection' mean the 2 items they selected:",
        "- Reading/A.md",
        "- Reading/B.md",
      ].join("\n"),
    );
  });

  it("says how many more were selected than the paths it lists", () => {
    const paths = Array.from({ length: 200 }, (_, index) => `Unsorted/${String(index)}.md`);
    const block = composeViewContextBlock(
      libraryContext({ paths, scope: { kind: "unsorted" }, selected: 1240 }),
      NO_FACTS,
    );
    expect(block.split("\n").slice(0, 2)).toEqual([
      "The person sent this from their library, looking at Unsorted.",
      "'These', 'this' and 'the selection' mean the 1240 items they selected (the first 200 of 1240):",
    ]);
    expect(block.split("\n")).toHaveLength(202);
  });

  it("names the listing command for the view only when the session holds the CLI", () => {
    const tagged = libraryContext({
      kinds: ["video"],
      paths: ["Watch/Talk.md"],
      scope: { kind: "tag", tag: "talks" },
      selected: 1,
    });
    expect(composeViewContextBlock(tagged, NO_FACTS)).not.toContain("inteligir");
    expect(composeViewContextBlock(tagged, ALL_FACTS).split("\n")).toEqual([
      "The person sent this from their library, looking at items tagged #talks, only videos.",
      "'These', 'this' and 'the selection' mean the item they selected:",
      "- Watch/Talk.md",
      "`inteligir items --tag talks --kind video --json` lists them.",
    ]);
    expect(
      composeViewContextBlock(
        libraryContext({ q: "lemon", scope: { kind: "folder", path: "Cooking/Weeknight" } }),
        ALL_FACTS,
      )
        .split("\n")
        .at(-1),
    ).toBe(
      '`inteligir items --folder "Cooking/Weeknight" --json` lists them (without the search; `inteligir search "lemon" --json` finds its matches).',
    );
  });
});

describe("the Tidy my library block", () => {
  it("states the procedure, judged by the url, site, description and opening text", () => {
    const block = composePresetBlock("tidy-library", ALL_FACTS);
    expect(block.split("\n")[0]).toBe(
      "Tidy the person's library: file and tag the items in Unsorted/ and the items with no tags.",
    );
    expect(block).toContain(
      "Judge an item by its url, site, description and the opening of its text.",
    );
    expect(block).toContain(
      "Never change an item's text, title or url, and never delete anything.",
    );
    expect(block).toContain("Leave an item whose place is unclear where it is, and name it.");
  });

  it("works through every item in batches of 100, with no cap on the run", () => {
    const block = composePresetBlock("tidy-library", ALL_FACTS);
    expect(TIDY_BATCH).toBe(100);
    expect(block).toContain("Work through all of them in this one run, in batches of 100");
    expect(block).toContain("`inteligir items --folder Unsorted --limit 100 --json`");
    expect(block).toContain("`inteligir items --untagged --limit 100 --json`");
    expect(block).toContain('("Filed 300 of 1,240")');
    expect(block).toContain("Do not stop until none is left, or every one left is unclear.");
    expect(block).toContain("the unclear ones by name (at most 20, then how many more)");
    expect(block).not.toMatch(/at most \d+ items|only the first/u);
  });

  it("names the commands only when the session holds the CLI", () => {
    expect(composePresetBlock("tidy-library", ALL_FACTS)).toContain("`inteligir vault rename");
    expect(composePresetBlock("tidy-library", ALL_FACTS)).toContain("`inteligir tag add");
    const withoutCli = composePresetBlock("tidy-library", { cli: false, filingRules: true });
    expect(withoutCli).not.toContain("inteligir");
    expect(withoutCli).toContain("moving its file into the folder");
    expect(withoutCli).toContain("frontmatter `tags` list");
  });

  it("follows the library's filing rules when it has them, and states the defaults when not", () => {
    expect(composePresetBlock("tidy-library", ALL_FACTS)).toContain(
      "the library's filing rules (its AGENTS.md, in your instructions above)",
    );
    const defaults = composePresetBlock("tidy-library", { cli: true, filingRules: false });
    expect(defaults).toContain(
      "file by topic into the folders that already exist, and make a new folder only when five or more items belong in it",
    );
    expect(defaults).toContain("never by kind");
    expect(defaults).not.toContain("AGENTS.md");
  });
});

describe("turnPromptInput", () => {
  it("carries the user's text alone when there is no context", () => {
    expect(turnPromptInput({ text: "make this shorter" }, NO_FACTS)).toEqual([
      { text: "make this shorter", type: "text" },
    ]);
  });

  it("leads with the view-context block and leaves the user's text its own element", () => {
    const input = turnPromptInput(
      { text: "make this shorter", viewContext: docContext() },
      NO_FACTS,
    );
    expect(input).toHaveLength(2);
    expect(input[0]?.text).toBe(composeViewContextBlock(docContext(), NO_FACTS));
    expect(input[1]).toEqual({ text: "make this shorter", type: "text" });
  });

  it("runs instructions, preset, view context, attached items, then the text", () => {
    const view = libraryContext({ scope: { kind: "unsorted" } });
    const input = turnPromptInput(
      {
        contextPaths: ["Notes/Plans.md", "Notes/Goals.md"],
        preset: "tidy-library",
        text: "Tidy my library",
        viewContext: view,
      },
      ALL_FACTS,
      "the instructions",
    );
    expect(input.map((block) => block.text)).toEqual([
      "the instructions",
      composePresetBlock("tidy-library", ALL_FACTS),
      composeViewContextBlock(view, ALL_FACTS),
      composeContextPathsBlock(["Notes/Plans.md", "Notes/Goals.md"]),
      "Tidy my library",
    ]);
    expect(composeContextPathsBlock(["Notes/Plans.md"])).toContain("- Notes/Plans.md");
  });

  it("draws no block for an empty attachment list", () => {
    expect(turnPromptInput({ contextPaths: [], text: "hi" }, NO_FACTS)).toEqual([
      { text: "hi", type: "text" },
    ]);
  });
});
