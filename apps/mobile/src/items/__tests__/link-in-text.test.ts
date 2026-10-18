import { describe, expect, it } from "vitest";
import { linkInText } from "../link-in-text";

const urlIn = (text: string): string | null => linkInText(text)?.url ?? null;

describe("a link inside text", () => {
  it("keeps a closing bracket the link opened", () => {
    expect(urlIn("https://en.wikipedia.org/wiki/Foo_(bar)")).toBe(
      "https://en.wikipedia.org/wiki/Foo_(bar)",
    );
    expect(urlIn("Read https://en.wikipedia.org/wiki/Foo_(bar), then call.")).toBe(
      "https://en.wikipedia.org/wiki/Foo_(bar)",
    );
    expect(urlIn("https://x.y/list[1]")).toBe("https://x.y/list[1]");
    expect(urlIn("https://x.y/{id}")).toBe("https://x.y/{id}");
  });

  it("leaves the sentence its own bracket and punctuation", () => {
    expect(urlIn("(see https://x.y/z)")).toBe("https://x.y/z");
    expect(urlIn("https://x.y/a).")).toBe("https://x.y/a");
    expect(urlIn("Read this before Tuesday: https://x.y/a.")).toBe("https://x.y/a");
    expect(urlIn("Really? https://x.y/a?!")).toBe("https://x.y/a");
    expect(urlIn("[https://x.y/a]")).toBe("https://x.y/a");
  });

  it("balances nested brackets, inside the link and around it", () => {
    expect(urlIn("https://x.y/a_(b_(c))")).toBe("https://x.y/a_(b_(c))");
    expect(urlIn("(see https://en.wikipedia.org/wiki/Foo_(bar)).")).toBe(
      "https://en.wikipedia.org/wiki/Foo_(bar)",
    );
    expect(urlIn("[see https://x.y/a_(b)]")).toBe("https://x.y/a_(b)");
    expect(urlIn("((https://x.y/a_(b_(c)))))")).toBe("https://x.y/a_(b_(c))");
  });

  it("leaves the sentence the marks a phone's keyboard types", () => {
    expect(linkInText("Read “https://example.com/a” tonight")).toStrictEqual({
      rest: "Read tonight",
      url: "https://example.com/a",
    });
    expect(urlIn("Read ‘https://example.com/a’")).toBe("https://example.com/a");
    expect(urlIn("Look at https://example.com/a…")).toBe("https://example.com/a");
    expect(urlIn("（https://example.com/a）")).toBe("https://example.com/a");
    expect(urlIn("https://example.com/a_（b）")).toBe("https://example.com/a_（b）");
    expect(urlIn("見て https://example.com/a。")).toBe("https://example.com/a");
    expect(urlIn("«https://example.com/a»")).toBe("https://example.com/a");
    expect(urlIn("https://example.com/don’t-panic")).toBe("https://example.com/don’t-panic");
  });

  it("keeps none of the brackets or quotes the link sat in for the note", () => {
    expect(linkInText("(see https://x.y/z)")).toStrictEqual({ rest: "see", url: "https://x.y/z" });
    expect(linkInText("[Foo](https://en.wikipedia.org/wiki/Foo_(bar))")).toStrictEqual({
      rest: "Foo",
      url: "https://en.wikipedia.org/wiki/Foo_(bar)",
    });
    expect(linkInText("Read [the post](https://x.y/a) first")).toStrictEqual({
      rest: "Read the post first",
      url: "https://x.y/a",
    });
    expect(linkInText("[https://x.y/a]")).toStrictEqual({ rest: "", url: "https://x.y/a" });
    expect(linkInText("(a) and (see https://x.y/z)")).toStrictEqual({
      rest: "(a) and see",
      url: "https://x.y/z",
    });
    expect(linkInText("“https://x.y/a.” he said")).toStrictEqual({
      rest: "he said",
      url: "https://x.y/a",
    });
  });

  it("takes the rest of the text as the note, the link's punctuation with it", () => {
    expect(linkInText("For Tuesday: https://en.wikipedia.org/wiki/Foo_(bar).")).toStrictEqual({
      rest: "For Tuesday:",
      url: "https://en.wikipedia.org/wiki/Foo_(bar)",
    });
    expect(linkInText("no link here")).toBeNull();
    expect(linkInText("https://)")).toBeNull();
  });
});
