// "Keep a copy of the page": the plan names what the copy needs, and the build leaves nothing in
// it that runs or loads, inlining what the server fetched and dropping the rest.

import { describe, expect, it } from "vitest";

import { buildCopy, planCopy } from "../copy-page";
import type { CopyBuildJob } from "../copy-page";

const PAGE_URL = "https://pages.example/post/one";
const SCRIPT_SCHEME = ["java", "script:"].join("");

const HOSTILE = `<!doctype html>
<html>
<head>
<base href="https://evil.example/">
<meta http-equiv="refresh" content="0; url=https://evil.example/">
<meta charset="windows-1252">
<link rel="stylesheet" href="/css/site.css">
<link rel="preload" href="/font.woff2">
<link rel="icon" href="/favicon.ico">
<style>@import url("/css/print.css"); body { background: url(/img/paper.png) }</style>
<script>alert(1)</script>
</head>
<body onload="steal()">
<h1 onclick="track()">A title</h1>
<p>Read <a href="/next">the next post</a> or <a href="${SCRIPT_SCHEME}alert(2)">click here</a>.</p>
<p style="background-image: url('/img/dots.png')">Styled</p>
<img src="/img/photo.jpg" srcset="/img/photo-800.jpg 800w, /img/photo-1600.jpg 1600w, /img/photo-3200.jpg 3200w" alt="A photo">
<picture><source srcset="/img/pic-1200.webp 1200w"><img src="/img/pic.jpg" alt="A picture"></picture>
<img src="/img/missing.png" alt="Not fetched">
<iframe src="https://ads.example/" srcdoc="<script>alert(3)</script>"></iframe>
<object data="/x.swf"></object><embed src="/y.swf"><applet code="z"></applet>
<form action="https://evil.example/collect"><input name="q" formaction="https://evil.example/2"><button>Go</button></form>
<video poster="/img/poster.jpg" src="/v.mp4"><source src="/v.webm"><track src="/v.vtt"></video>
<noscript><p>No script text</p></noscript>
<map><area href="/area" alt="area"></map>
<div data-x="1" style="color: red">kept</div>
</body>
</html>`;

const dataUri = (label: string): string =>
  `data:image/png;base64,${Buffer.from(label).toString("base64")}`;

const big = (label: string, size: number) => ({
  bytes: size,
  dataUri: `data:image/png;base64,${"A".repeat(size)}`,
  kind: "image" as const,
  url: `https://evil.example/img/${label}`,
});

const job = (overrides: Partial<CopyBuildJob> = {}): CopyBuildJob => ({
  files: [
    {
      bytes: 10,
      dataUri: dataUri("paper"),
      kind: "image",
      url: "https://evil.example/img/paper.png",
    },
    {
      bytes: 10,
      dataUri: dataUri("dots"),
      kind: "image",
      url: "https://evil.example/img/dots.png",
    },
    {
      bytes: 10,
      dataUri: dataUri("photo"),
      kind: "image",
      url: "https://evil.example/img/photo-1600.jpg",
    },
    {
      bytes: 10,
      dataUri: dataUri("pic"),
      kind: "image",
      url: "https://evil.example/img/pic-1200.webp",
    },
    {
      bytes: 10,
      dataUri: dataUri("poster"),
      kind: "image",
      url: "https://evil.example/img/poster.jpg",
    },
    {
      bytes: 10,
      dataUri: "data:font/woff2;base64,AAAA",
      kind: "font",
      url: "https://evil.example/f.woff2",
    },
  ],
  html: HOSTILE,
  maxBytes: 10 * 1024 * 1024,
  savedOn: "2026-10-17",
  stylesheets: [
    {
      css: "@font-face { font-family: X; src: url(/f.woff2) } h1 { color: navy }",
      url: "https://evil.example/css/site.css",
    },
    { css: "@media print { body { color: black } }", url: "https://evil.example/css/print.css" },
  ],
  url: PAGE_URL,
  ...overrides,
});

const built = (overrides: Partial<CopyBuildJob> = {}): string => {
  const result = buildCopy(job(overrides));
  if (result.kind !== "copy") {
    throw new Error("expected a copy");
  }
  return result.html;
};

describe("planCopy", () => {
  it("names stylesheets, inline style references, imports and the best source of each picture", () => {
    const plan = planCopy(HOSTILE, PAGE_URL);
    // the page's <base> decides how its relative addresses resolve, as a browser would read it
    expect(plan.stylesheets).toEqual(["https://evil.example/css/site.css"]);
    expect(plan.styleImports).toEqual(["https://evil.example/css/print.css"]);
    expect(plan.styleRefs).toEqual([
      { kind: "image", url: "https://evil.example/img/paper.png" },
      { kind: "image", url: "https://evil.example/img/dots.png" },
    ]);
    expect(plan.images).toEqual([
      "https://evil.example/img/photo-1600.jpg",
      "https://evil.example/img/pic-1200.webp",
      "https://evil.example/img/missing.png",
      "https://evil.example/img/poster.jpg",
    ]);
  });
});

describe("buildCopy", () => {
  const html = built();

  it("keeps no script, frame, object, base, refresh, handler, srcdoc or form action", () => {
    for (const banned of [
      "<script",
      "<iframe",
      "<object",
      "<embed",
      "<applet",
      "<base",
      'http-equiv="refresh"',
      "onload",
      "onclick",
      "srcdoc",
      "action=",
      "formaction",
      SCRIPT_SCHEME,
      "alert(",
    ]) {
      expect(html, banned).not.toContain(banned);
    }
  });

  it("disarms every link, its address moved to the title", () => {
    expect(html).toContain('<a title="https://evil.example/next">the next post</a>');
    expect(html).toContain("<a>click here</a>");
    expect(html).toContain('<area title="https://evil.example/area" alt="area">');
  });

  it("inlines what was fetched as data and drops what was not", () => {
    expect(html).toContain("h1 { color: navy }");
    expect(html).toContain("@media print { body { color: black } }");
    expect(html).toContain(`url("${dataUri("paper")}")`);
    expect(html).toContain(`url(&quot;${dataUri("dots")}&quot;)`);
    expect(html).toContain(`src="${dataUri("photo")}"`);
    expect(html).toContain(`src="${dataUri("pic")}"`);
    expect(html).toContain(`poster="${dataUri("poster")}"`);
    expect(html).toContain("data:font/woff2;base64,AAAA");
    expect(html).toContain("Not fetched");
    expect(html).not.toContain("missing.png");
    expect(html).not.toContain("srcset");
    expect(html).not.toContain("<source");
    expect(html).not.toContain("<track");
    expect(html).not.toContain("favicon");
    expect(html).not.toContain("v.mp4");
  });

  it("unwraps noscript and keeps harmless attributes", () => {
    expect(html).toContain("No script text");
    expect(html).not.toContain("<noscript");
    expect(html).toContain('<div data-x="1" style="color: red">kept</div>');
  });

  it("carries its own charset, a policy that loads nothing, and where it came from", () => {
    expect(
      html.startsWith(
        "<!DOCTYPE html>\n<!-- Saved by inteligir from https://pages.example/post/one on 2026-10-17 -->\n",
      ),
    ).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain(
      "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:",
    );
    expect(html).not.toContain("windows-1252");
  });

  it("names a source address that could close its comment without closing it", () => {
    const tricky = built({ url: "https://pages.example/a-->b" });
    expect(tricky).toContain("from https://pages.example/a%2D%2D%3Eb on");
  });

  it("drops fonts first, then the largest pictures, and refuses what still does not fit", () => {
    const files = [
      {
        bytes: 3000,
        dataUri: `data:font/woff2;base64,${"F".repeat(3000)}`,
        kind: "font" as const,
        url: "https://evil.example/f.woff2",
      },
      big("photo-1600.jpg", 2000),
      big("pic-1200.webp", 500),
    ];
    const fitsWithoutFont = buildCopy(job({ files, maxBytes: HOSTILE.length + 3000 }));
    expect(fitsWithoutFont.kind).toBe("copy");
    if (fitsWithoutFont.kind === "copy") {
      expect(fitsWithoutFont.html).not.toContain("FFFF");
      expect(fitsWithoutFont.html).toContain("A".repeat(500));
    }
    const fitsWithoutPhoto = buildCopy(job({ files, maxBytes: HOSTILE.length + 1200 }));
    expect(fitsWithoutPhoto.kind).toBe("copy");
    if (fitsWithoutPhoto.kind === "copy") {
      expect(fitsWithoutPhoto.html).not.toContain("A".repeat(2000));
      expect(fitsWithoutPhoto.html).toContain("A photo");
    }
    expect(buildCopy(job({ files, maxBytes: 200 }))).toEqual({ kind: "copy-too-big" });
  });
});
