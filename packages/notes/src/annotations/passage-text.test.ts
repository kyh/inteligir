import { describe, expect, it } from "vitest";

import { annotationPassages, projectPassages } from "./passage-text";

describe("the text a person reads", () => {
  it("folds whitespace, puts blocks a space apart and skips what is not prose", () => {
    const content = [
      "---",
      "title: hidden",
      "---",
      "",
      "# A  heading",
      "",
      "Some *styled* text",
      "across lines.",
      "",
      "```js",
      "const code = 1;",
      "```",
      "",
      "> quoted",
      "> more",
      "",
      "- one",
      "- two",
      "",
      "| a | b |",
      "| - | - |",
      "| c | d |",
      "",
      "$$",
      "x^2",
      "$$",
      "",
    ].join("\n");
    expect(projectPassages(content).text).toBe(
      "A heading Some styled text across lines. quoted more one two a b c d ",
    );
  });

  it("reads a pill, a date chip, a wiki link and inline code as what they show", () => {
    expect(
      projectPassages("Total {{1+1|2}} on @2026-10-17 in [[Target|the target]] and `x`.\n").text,
    ).toBe("Total 2 on 2026-10-17 in the target and x. ");
  });

  it("leaves a container's lines and an alert's marker out of the text", () => {
    expect(projectPassages(":::toggle\nInside the toggle.\n:::\n").text).toBe(
      "Inside the toggle. ",
    );
    expect(projectPassages("> [!NOTE]\n> Mind this.\n").text).toBe("Mind this. ");
  });

  it("leaves an escaped container line out too, so no marker lands beside its escape", () => {
    expect(projectPassages("before\n\\:::toggle\nafter\n").text).toBe("before after ");
  });

  it.each([
    ["a url", String.raw`https\://a.bc`],
    ["a url and a word", String.raw`https\://a.bc docs`],
    ["a www address and a word", String.raw`www\.a.bc site`],
    ["an email address and a word", String.raw`a\@b.cd team`],
    ["an address between words", String.raw`see https\://a.bc/d now`],
  ])(
    "leaves out a tab's label holding %s, which the transform reads as one line",
    (_name, label) => {
      expect(
        projectPassages(`:::tabs\n=== ${label}\nbody here\n=== Second\nmore\n:::\n`).text,
      ).toBe("body here more ");
    },
  );

  it("reads a footnote's call as nothing, its definition in view or not", () => {
    expect(projectPassages("One[^a] word.\n\n[^a]: said\n").text).toBe("One word. ");
    expect(projectPassages("One[^a] word.\n").text).toBe("One word. ");
    expect(projectPassages(String.raw`One\[^a] word.`).text).toBe("One[^a] word. ");
    expect(projectPassages(String.raw`One[\^a] word.`).text).toBe("One[^a] word. ");
  });

  it.each([
    ["a bare url", "https://x.y/?q=[^a-z]+b", "https://x.y/?q=[^a-z]+b"],
    ["a www address", "www.x.y/?q=[^a-z]+b", "www.x.y/?q=[^a-z]+b"],
    ["an angled url", "<https://x.y/?q=[^a-z]+b>", "https://x.y/?q=[^a-z]+b"],
    ["a marked bare url", "_https://x.y/?q=[^a-z]+b_", "https://x.y/?q=[^a-z]+b"],
    [
      "a label the writer drops",
      "[https://x.y/?q=[^a-z]+b](https://x.y/?q=[^a-z]+b)",
      "https://x.y/?q=[^a-z]+b",
    ],
  ])("reads %s whole, its text being its address", (_name, spelled, read) => {
    expect(projectPassages(`see ${spelled} now\n`).text).toBe(`see ${read} now `);
  });

  it.each([
    ["words of its own", "[see [^a] here](https://x.y/z) now", "see here now "],
    [
      "its address and a title",
      '[https://x.y/[^a]b](https://x.y/[^a]b "words") now',
      "https://x.y/b now ",
    ],
    [
      "an address no literal ends on",
      "[https://x.y/[^a]b!](https://x.y/[^a]b!) now",
      "https://x.y/b! now ",
    ],
    [
      "an address a word touches",
      "[https://x.y/[^a]b](https://x.y/[^a]b)c now",
      "https://x.y/bc now ",
    ],
    [
      "an address a word stands before",
      "c[https://x.y/[^a]b](https://x.y/[^a]b) now",
      "chttps://x.y/b now ",
    ],
  ])("reads a call in a label of %s as nothing", (_name, spelled, read) => {
    expect(projectPassages(`${spelled}\n`).text).toBe(read);
  });

  it("reads a cell's lines as blocks a space apart", () => {
    const projection = projectPassages("| a |\n| - |\n| one<br/>two |\n");
    expect(projection.text).toBe("a one two ");
    const { block, text } = projection;
    expect(block[text.indexOf("one")]).not.toBe(block[text.indexOf("two")]);
    expect(block[text.indexOf(" two")]).toBe(-1);
  });

  it.each([
    ["outside a cell", "one<br/>two\n", "onetwo "],
    ["in another spelling", "| a |\n| - |\n| one<br>two |\n", "a onetwo "],
    [
      "as text",
      String.raw`| a |
| - |
| one\<br/>two |
`,
      "a one<br/>two ",
    ],
    ["in a link's label", "| a |\n| - |\n| [one<br/>two](https://x.y/z) |\n", "a onetwo "],
  ])("reads a tag %s as no edge", (_name, source, read) => {
    expect(projectPassages(source).text).toBe(read);
  });

  it("reads an address on a line that is no label", () => {
    expect(projectPassages(`before https\\://a.bc after\nmore\n`).text).toBe(
      "before https://a.bc after more ",
    );
  });

  it("maps each character to the bytes that spell it", () => {
    const content = "a \\* b &amp; c\n";
    const projection = projectPassages(content);
    expect(projection.text).toBe("a * b & c ");
    const star = projection.text.indexOf("*");
    expect(content.slice(projection.from[star], projection.to[star])).toBe("\\*");
    const ampersand = projection.text.indexOf("&");
    expect(content.slice(projection.from[ampersand], projection.to[ampersand])).toBe("&amp;");
  });

  it("names the bytes past a leading byte-order mark", () => {
    const content = "\uFEFFplain word\n";
    const projection = projectPassages(content);
    const word = projection.text.indexOf("word");
    expect(content.slice(projection.from[word], projection.to[word + 3])).toBe("word");
  });
});

describe("the live passage between an annotation's markers", () => {
  it("is the folded text its markers wrap, inline constructs and blocks included", () => {
    const content = [
      "The %%i:a1:start%%first **bold**",
      "line%%i:a1:end%% and %%i:b2:start%%a",
      "",
      "second%%i:b2:end%% block.",
      "",
    ].join("\n");
    expect(annotationPassages(content)).toStrictEqual(
      new Map([
        ["a1", "first bold line"],
        ["b2", "a second"],
      ]),
    );
  });

  it("reads a marker inside a link or emphasis", () => {
    expect(annotationPassages("**a %%i:a1:start%%b%%i:a1:end%% c**\n").get("a1")).toBe("b");
  });
});
