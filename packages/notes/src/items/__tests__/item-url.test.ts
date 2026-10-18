import { describe, expect, it } from "vitest";

import {
  cleanUrl,
  isWebUrl,
  kindForUrl,
  siteMatches,
  urlHost,
  urlKey,
  urlSearchText,
} from "../item-url";
import { mulberry32, pick } from "../../__tests__/seeded-random";

describe("isWebUrl", () => {
  it.each([
    ["https://example.com", true],
    ["http://example.com/a?b#c", true],
    ["  HTTPS://Example.com/  ", true],
    ["http://[::1]:8080/x", true],
    ["https://user:pw@example.com", true],
    ["ftp://example.com", false],
    ["example.com", false],
    ["https://", false],
    ["https:///path", false],
    ["https://exa mple.com", false],
    ["https://example.com/a b", false],
    ["https://example.com:80a/", false],
    ["https://./", false],
    ["mailto:a@b.com", false],
    ["", false],
  ])("%j → %s", (value, expected) => {
    expect(isWebUrl(value)).toBe(expected);
  });
});

describe("urlKey", () => {
  it.each([
    [
      "https://www.Example.com:443/a/./b/../c/?utm_source=x&b=2&a=1#frag",
      "example.com/a/c?a=1&b=2",
    ],
    ["http://user:pw@example.com:80", "example.com/"],
    ["https://example.com:8080/x", "example.com:8080/x"],
    ["HTTPS://EXAMPLE.COM/Path", "example.com/Path"],
    ["https://example.com./a/", "example.com/a"],
    ["https://example.com/?", "example.com/"],
    ["https://example.com/?b=2&a=2&a=1", "example.com/?a=1&a=2&b=2"],
    ["https://example.com/x?UTM_Source=a&fbclid=b&gclid=c&keep=1", "example.com/x?keep=1"],
    ["https://example.com/%7euser/%e2%82%ac", "example.com/~user/%E2%82%AC"],
    ["https://example.com/café", "example.com/caf%C3%A9"],
    ["https://app.example.com/#/inbox", "app.example.com/#/inbox"],
    ["https://example.com/#!/post", "example.com/#!/post"],
    ["https://example.com/page#section", "example.com/page"],
    ["https://youtu.be/dQw4w9WgXcQ?si=abc&t=42", "youtube.com/watch?t=42&v=dQw4w9WgXcQ"],
    ["https://m.youtube.com/watch?v=dQw4w9WgXcQ&feature=share", "youtube.com/watch?v=dQw4w9WgXcQ"],
    ["https://music.youtube.com/watch?v=x&si=1&pp=2", "youtube.com/watch?v=x"],
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10", "youtube.com/watch?t=10&v=dQw4w9WgXcQ"],
    ["https://x.com/jack/status/20?s=20&t=abc", "twitter.com/jack/status/20"],
    ["https://mobile.twitter.com/jack", "twitter.com/jack"],
    ["https://en.m.wikipedia.org/wiki/URL", "en.wikipedia.org/wiki/URL"],
    ["https://m.example.com/", "m.example.com/"],
    ["https://open.spotify.com/track/abc?si=123&context=x", "open.spotify.com/track/abc"],
    ["https://example.com/?si=1&t=2", "example.com/?si=1&t=2"],
    ["http://[::1]:8080/x", "[::1]:8080/x"],
    ["https://example.com/a/..", "example.com/"],
    ["https://example.com/%2e%2e/b", "example.com/b"],
  ])("%s → %s", (value, expected) => {
    expect(urlKey(value)).toBe(expected);
  });

  it("is null for anything that is not a web address", () => {
    for (const value of ["ftp://x.com", "example.com", "https://", "", "data:text/plain,x"]) {
      expect(urlKey(value)).toBeNull();
    }
  });
});

describe("cleanUrl", () => {
  it.each([
    [
      "https://user:pw@www.Example.com/a?utm_source=x&b=2&a=1#frag",
      "https://www.Example.com/a?b=2&a=1#frag",
    ],
    ["https://example.com/?utm_source=x", "https://example.com/"],
    ["https://youtu.be/abc?si=x", "https://youtu.be/abc"],
    ["https://youtu.be/abc?si=x&t=3", "https://youtu.be/abc?t=3"],
    ["  https://a.com  ", "https://a.com"],
    ["HTTP://Example.com:8080/Path?Z=1&a=2", "HTTP://Example.com:8080/Path?Z=1&a=2"],
    ["https://example.com/?a=1&&b=2", "https://example.com/?a=1&&b=2"],
    ["https://example.com/?a=1&&fbclid=2", "https://example.com/?a=1"],
  ])("%s → %s", (value, expected) => {
    expect(cleanUrl(value)).toBe(expected);
  });

  it("is null for anything that is not a web address", () => {
    expect(cleanUrl("not a url")).toBeNull();
  });
});

describe("kindForUrl", () => {
  it.each([
    ["https://www.youtube.com/watch?v=x", "video"],
    ["https://youtu.be/x", "video"],
    ["https://youtube.com/shorts/x", "video"],
    ["https://youtube.com/live/x", "video"],
    ["https://m.youtube.com/watch?v=x", "video"],
    ["https://youtube.com/@channel", "link"],
    ["https://vimeo.com/123456", "video"],
    ["https://vimeo.com/channels/staff/123456", "video"],
    ["https://vimeo.com/about", "link"],
    ["https://www.tiktok.com/@user/video/123", "video"],
    ["https://www.dailymotion.com/video/x8", "video"],
    ["https://www.loom.com/share/abc", "video"],
    ["https://open.spotify.com/track/x", "audio"],
    ["https://open.spotify.com/episode/x", "audio"],
    ["https://open.spotify.com/artist/x", "link"],
    ["https://soundcloud.com/artist/track", "audio"],
    ["https://soundcloud.com/artist", "link"],
    ["https://podcasts.apple.com/us/podcast/x", "audio"],
    ["https://music.apple.com/us/album/x", "audio"],
    ["https://stephango.com/file-over-app", "link"],
    ["not a url", "link"],
  ])("%s → %s", (value, expected) => {
    expect(kindForUrl(value)).toBe(expected);
  });
});

describe("urlHost, urlSearchText and siteMatches", () => {
  it("reads the host without www. or a port", () => {
    expect(urlHost("https://WWW.Example.com:8080/x")).toBe("example.com");
    expect(urlHost("https://example.com./")).toBe("example.com");
    expect(urlHost("nope")).toBeNull();
  });

  it("indexes the host and the path's words", () => {
    expect(urlSearchText("https://stephango.com/file-over-app")).toBe(
      "stephango.com file over app",
    );
    expect(urlSearchText("https://example.com/caf%C3%A9_menu.html")).toBe(
      "example.com café menu html",
    );
    expect(urlSearchText("nope")).toBe("");
  });

  it.each([
    ["blog.example.com", "example.com", true],
    ["example.com", "example.com", true],
    ["example.com", "Example.COM", true],
    ["notexample.com", "example.com", false],
    ["youtube.com", "https://www.youtube.com/watch?v=1", true],
    ["example.com", "www.example.com", true],
    ["example.com", "example.com/path", true],
    ["example.com", "", false],
    [null, "example.com", false],
  ])("%s within %j is %s", (host, filter, expected) => {
    expect(siteMatches(host, filter)).toBe(expected);
  });
});

const SCHEMES = ["http", "https", "HTTPS"];
const USERINFO = ["", "", "user@", "user:pw@"];
const HOSTS = [
  "example.com",
  "www.Example.com",
  "youtu.be",
  "www.youtube.com",
  "m.youtube.com",
  "x.com",
  "mobile.twitter.com",
  "en.m.wikipedia.org",
  "open.spotify.com",
  "soundcloud.com",
  "example.com.",
  "[::1]",
];
const PORTS = ["", "", ":80", ":443", ":8080"];
const SEGMENTS = ["a", "B", ".", "..", "%7e", "%2F", "é", "watch", "shorts", "123", "x-y_z"];
const PARAMS = [
  "a=1",
  "b=2",
  "utm_source=x",
  "UTM_MEDIUM=y",
  "fbclid=z",
  "si=1",
  "t=2",
  "s=3",
  "feature=f",
  "context=c",
  "v=id",
  "flag",
  "",
  "%7e=%7e",
];
const FRAGMENTS = ["", "sec", "/route", "!bang", "%2Fx"];

const randomUrl = (rand: () => number): string => {
  const path = Array.from({ length: Math.floor(rand() * 4) }, () => pick(rand, SEGMENTS)).join("/");
  const params = Array.from({ length: Math.floor(rand() * 4) }, () => pick(rand, PARAMS));
  const fragment = pick(rand, FRAGMENTS);
  const trailing = rand() < 0.3 ? "/" : "";
  return (
    `${pick(rand, SCHEMES)}://${pick(rand, USERINFO)}${pick(rand, HOSTS)}${pick(rand, PORTS)}` +
    `${path === "" ? "" : `/${path}`}${trailing}` +
    `${params.length === 0 && rand() < 0.5 ? "" : `?${params.join("&")}`}` +
    `${fragment === "" ? "" : `#${fragment}`}`
  );
};

describe("the seeded properties", () => {
  it("a cleaned url keeps its key, cleaning twice is cleaning once, and the kind holds", () => {
    const rand = mulberry32(0x5e_ed_01);
    for (let i = 0; i < 4000; i += 1) {
      const url = randomUrl(rand);
      const cleaned = cleanUrl(url);
      expect(cleaned, url).not.toBeNull();
      if (cleaned === null) {
        continue;
      }
      expect(urlKey(url), url).not.toBeNull();
      expect(urlKey(cleaned), url).toBe(urlKey(url));
      expect(cleanUrl(cleaned), url).toBe(cleaned);
      expect(kindForUrl(cleaned), url).toBe(kindForUrl(url));
      expect(urlHost(cleaned), url).toBe(urlHost(url));
    }
  });
});
