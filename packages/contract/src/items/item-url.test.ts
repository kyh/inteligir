import { describe, expect, it } from "vitest";

import { cleanUrl, isWebUrl, kindForUrl, urlHost, urlKey, urlSearchText } from "./item-url";

describe(isWebUrl, () => {
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
    ["https:example.com", false],
    ["https:\\\\example.com", false],
    ["https://exa mple.com", false],
    ["https://example.com/a b", false],
    ["https://example.com:80a/", false],
    ["https://example.com:65535/", true],
    ["https://example.com:65536/", false],
    ["https://./", false],
    ["mailto:a@b.com", false],
    ["", false],
  ])("%j → %s", (value, expected) => {
    expect(isWebUrl(value)).toBe(expected);
  });
});

describe(urlKey, () => {
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
    ["https://münchen.de/x", "xn--mnchen-3ya.de/x"],
    ["https://xn--mnchen-3ya.de/x", "xn--mnchen-3ya.de/x"],
  ])("%s → %s", (value, expected) => {
    expect(urlKey(value)).toBe(expected);
  });

  it("is null for anything that is not a web address", () => {
    for (const value of ["ftp://x.com", "example.com", "https://", "", "data:text/plain,x"]) {
      expect(urlKey(value)).toBeNull();
    }
  });
});

describe(cleanUrl, () => {
  it.each([
    [
      "https://user:pw@www.Example.com/a?utm_source=x&b=2&a=1#frag",
      "https://www.example.com/a?b=2&a=1#frag",
    ],
    ["https://example.com/?utm_source=x", "https://example.com/"],
    ["https://youtu.be/abc?si=x", "https://youtu.be/abc"],
    ["https://youtu.be/abc?si=x&t=3", "https://youtu.be/abc?t=3"],
    ["  https://a.com  ", "https://a.com/"],
    ["HTTP://Example.com:8080/Path?Z=1&a=2", "http://example.com:8080/Path?Z=1&a=2"],
    ["https://example.com/a/../b/café", "https://example.com/b/caf%C3%A9"],
    ["https://münchen.de/", "https://xn--mnchen-3ya.de/"],
    ["https://example.com/?a=1&&b=2", "https://example.com/?a=1&b=2"],
    ["https://example.com/?a=1&&fbclid=2", "https://example.com/?a=1"],
  ])("%s → %s", (value, expected) => {
    expect(cleanUrl(value)).toBe(expected);
  });

  it("is null for anything that is not a web address", () => {
    expect(cleanUrl("not a url")).toBeNull();
  });
});

describe(kindForUrl, () => {
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

describe("urlHost and urlSearchText", () => {
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
});
