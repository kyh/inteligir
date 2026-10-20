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

  it("maps each character to the bytes that spell it", () => {
    const content = "a \\* b &amp; c\n";
    const projection = projectPassages(content);
    expect(projection.text).toBe("a * b & c ");
    const star = projection.text.indexOf("*");
    expect(content.slice(projection.from[star], projection.to[star])).toBe("\\*");
    const ampersand = projection.text.indexOf("&");
    expect(content.slice(projection.from[ampersand], projection.to[ampersand])).toBe("&amp;");
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
    expect(annotationPassages(content)).toEqual(
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
