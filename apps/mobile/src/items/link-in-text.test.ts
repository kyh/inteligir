import { describe, expect, it } from "vitest";
import { linkInText, withoutLink } from "./link-in-text";

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

  it("keeps an apostrophe inside an address, in either spelling, and leaves one around it", () => {
    const murphy = "https://en.wikipedia.org/wiki/Murphy's_law";
    expect(linkInText(`Read ${murphy} tonight`)).toStrictEqual({
      rest: "Read tonight",
      url: murphy,
    });
    expect(linkInText(murphy)).toStrictEqual({ rest: "", url: murphy });
    expect(urlIn("https://en.wikipedia.org/wiki/O'Reilly_Media")).toBe(
      "https://en.wikipedia.org/wiki/O'Reilly_Media",
    );
    expect(urlIn("https://www.google.com/maps/place/Joe's+Pizza/@40.7,-74")).toBe(
      "https://www.google.com/maps/place/Joe's+Pizza/@40.7,-74",
    );
    const url = "https://example.com/z";
    expect(linkInText(`see '${url}' now`)).toStrictEqual({ rest: "see now", url });
    expect(linkInText(`read '${url}'.`)).toStrictEqual({ rest: "read", url });
    expect(linkInText(`'${url}', he said`)).toStrictEqual({ rest: "he said", url });
    expect(linkInText(`('${url}')`)).toStrictEqual({ rest: "", url });
    expect(linkInText(`it's ${url}`)).toStrictEqual({ rest: "it's", url });
  });

  it("ends a link at what no address holds, where a sentence runs straight on from it", () => {
    const url = "https://example.com/a";
    expect(linkInText(`これ ${url}。次の文`)).toStrictEqual({ rest: "これ 次の文", url });
    expect(linkInText(`これ（${url}）を見て`)).toStrictEqual({ rest: "これ を見て", url });
    expect(linkInText(`«${url}»、次`)).toStrictEqual({ rest: "次", url });
    expect(linkInText(`${url}…and more`)).toStrictEqual({ rest: "and more", url });
    expect(linkInText(`${url}👍 yes`)).toStrictEqual({ rest: "👍 yes", url });
    expect(linkInText(`👉${url}👈`)).toStrictEqual({ rest: "👉 👈", url });
    expect(linkInText(`${url}—the best`)).toStrictEqual({ rest: "—the best", url });
    expect(linkInText(`${url}\u200B next`)).toStrictEqual({ rest: "\u200B next", url });
    expect(linkInText(`(see ${url})and more`)).toStrictEqual({ rest: "see and more", url });
  });

  it("takes the emphasis a link sat in out of the note, both its ends", () => {
    const url = "https://example.com/a";
    expect(linkInText(`**${url}**`)).toStrictEqual({ rest: "", url });
    expect(linkInText(`*${url}*`)).toStrictEqual({ rest: "", url });
    expect(linkInText(`see **${url}** now`)).toStrictEqual({ rest: "see now", url });
    expect(linkInText(`see **“${url}”** now`)).toStrictEqual({ rest: "see now", url });
    expect(linkInText(`“**${url}**” he said`)).toStrictEqual({ rest: "he said", url });
    expect(linkInText(`5 * 3 ${url}*`)).toStrictEqual({ rest: "5 * 3", url });
    expect(linkInText(`*starred* ${url}`)).toStrictEqual({ rest: "*starred*", url });
  });

  it("keeps an address's letters and numbers, whatever their script", () => {
    expect(urlIn("Read https://ja.wikipedia.org/wiki/東京 tonight")).toBe(
      "https://ja.wikipedia.org/wiki/東京",
    );
    expect(urlIn("https://example.com/café/menu")).toBe("https://example.com/café/menu");
    expect(urlIn("https://hi.example/हिन्दी")).toBe("https://hi.example/हिन्दी");
    expect(urlIn("https://x.y/a,b;c=d|e")).toBe("https://x.y/a,b;c=d|e");
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
    expect(linkInText("Read <https://x.y/a> tonight")?.rest).toBe("Read tonight");
    expect(linkInText("Read `https://x.y/a` tonight")?.rest).toBe("Read tonight");
  });

  it("takes a quote and a bracket out together, whichever is inside", () => {
    expect(linkInText('(see "https://x.y/z")')?.rest).toBe("see");
    expect(linkInText("(see “https://x.y/z”) for more")?.rest).toBe("see for more");
    expect(linkInText('"(https://x.y/z)"')?.rest).toBe("");
    expect(linkInText("“（https://x.y/z）”")?.rest).toBe("");
  });

  it("takes the link out however often the text spells it", () => {
    expect(linkInText("https://x.y/a, again https://x.y/a/?utm_source=m")).toStrictEqual({
      rest: "again",
      url: "https://x.y/a",
    });
    expect(linkInText("[https://x.y/a](https://x.y/a)")).toStrictEqual({
      rest: "",
      url: "https://x.y/a",
    });
  });

  it("leaves the sentence's punctuation after a closing quote with the link", () => {
    expect(linkInText('read "https://x.y/a".')?.rest).toBe("read");
    expect(linkInText("read “https://x.y/a”, then call")?.rest).toBe("read then call");
    expect(linkInText("“https://x.y/a”.")?.rest).toBe("");
  });

  it("keeps the line breaks around the link, and only a space where there were none", () => {
    expect(linkInText("one\nhttps://x.y/a\ntwo")?.rest).toBe("one\ntwo");
    expect(linkInText("one\n\nhttps://x.y/a\n\ntwo")?.rest).toBe("one\n\ntwo");
    expect(linkInText("one\n\nhttps://x.y/a\ntwo")?.rest).toBe("one\n\ntwo");
    expect(linkInText("one https://x.y/a\ntwo")?.rest).toBe("one\ntwo");
    expect(linkInText("one   https://x.y/a   two")?.rest).toBe("one two");
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

describe("a link taken out of text", () => {
  it("takes out each spelling of it by the same rules, and leaves every other link", () => {
    expect(
      withoutLink("a https://x.y/z b (see https://x.y/z/?utm_source=m).", "https://x.y/z"),
    ).toBe("a b see");
    expect(withoutLink("a “https://x.y/z” b https://x.y/other c", "https://x.y/z")).toBe(
      "a b https://x.y/other c",
    );
    expect(withoutLink("a https://x.y/other b", "https://x.y/z")).toBe("a https://x.y/other b");
    expect(withoutLink("no link here", "https://x.y/z")).toBe("no link here");
  });

  it("takes out nothing for what names no page", () => {
    expect(withoutLink("a https://x.y/z b", "x.y")).toBe("a https://x.y/z b");
  });
});
