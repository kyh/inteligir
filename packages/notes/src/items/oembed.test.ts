import { describe, expect, it } from "vitest";

import { oembedEndpoint, parseOEmbed } from "./oembed";

type Answer = Readonly<Record<string, string | number | string[]>>;

const textBytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const answerBytes = (answer: Answer): Uint8Array => textBytes(JSON.stringify(answer));

describe("an oEmbed answer", () => {
  it("reads what a host says of a page", () => {
    expect(
      parseOEmbed(
        answerBytes({
          author_name: " The Baker ",
          html: "<p>Rise</p>",
          provider_name: "YouTube",
          thumbnail_url: "https://i.ytimg.com/vi/abc/hq.jpg",
          title: "Sourdough",
          type: "video",
        }),
      ),
    ).toStrictEqual({
      author: "The Baker",
      html: "<p>Rise</p>",
      provider: "YouTube",
      thumbnail: "https://i.ytimg.com/vi/abc/hq.jpg",
      title: "Sourdough",
    });
  });

  it.each([
    ["markup", "<html>not found</html>"],
    ["nothing", ""],
    ["a list", "[]"],
    ["a number", "7"],
    ["null", "null"],
  ])("is no answer when it is %s", (_name, text) => {
    expect(parseOEmbed(textBytes(text))).toBeNull();
  });

  it("reads an answer that holds only some of its fields", () => {
    expect(
      parseOEmbed(answerBytes({ author_name: "A Poster", html: "<p>Words</p>" })),
    ).toStrictEqual({
      author: "A Poster",
      html: "<p>Words</p>",
      provider: null,
      thumbnail: null,
      title: null,
    });
  });

  it("reads a field of the wrong type, or an empty one, as absent", () => {
    expect(
      parseOEmbed(answerBytes({ author_name: 7, provider_name: [], title: "" })),
    ).toStrictEqual({
      author: null,
      html: null,
      provider: null,
      thumbnail: null,
      title: null,
    });
  });

  it("clips a string past its limit", () => {
    const answer = parseOEmbed(answerBytes({ title: "x".repeat(5000) }));
    expect(answer?.title).toHaveLength(2000);
  });

  it.each(["file:///etc/passwd", "data:image/png;base64,AAAA", "//cdn.example/cover.png"])(
    "takes %s as no thumbnail, since only a web address is a cover candidate",
    (thumbnail_url) => {
      expect(parseOEmbed(answerBytes({ thumbnail_url }))?.thumbnail).toBeNull();
    },
  );
});

describe("where a fill asks", () => {
  const DISCOVERED = "https://pages.example/oembed?url=x";

  it("asks a media host's own endpoint before anything a page names", () => {
    const url = "https://www.youtube.com/watch?v=abc";
    expect(oembedEndpoint(url, DISCOVERED)).toBe(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`,
    );
  });

  it("asks the page's discovery link on any other host, and nothing without one", () => {
    expect(oembedEndpoint("https://pages.example/post", DISCOVERED)).toBe(DISCOVERED);
    expect(oembedEndpoint("https://pages.example/post", null)).toBeNull();
  });
});
