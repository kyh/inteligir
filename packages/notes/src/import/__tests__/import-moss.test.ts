import { describe, expect, it } from "vitest";

import type { CommentSidecar } from "../../comments/sidecar-schema";
import { extractCommentFooter } from "../comment-footer";
import { importMossDoc } from "../import-moss-doc";
import { migrateLegacyCommentMarkers } from "../legacy-comment-markers";
import { normalizeLaxMarkers, normalizeLaxTabs } from "../lax-forms";
import { normalizeMossHtmlHeaders } from "../moss-html-headers";

describe("legacy comment markers", () => {
  it("rewrites a paired open/close to the modern form", () => {
    const result = migrateLegacyCommentMarkers("before {%c:abc%}ranged{%/c%} after\n");
    expect(result.body).toBe("before %%m:abc:start%%ranged%%m:abc:end%% after\n");
    expect(result.migrated).toBe(1);
    expect(result.unpaired).toBe(0);
  });

  it("normalizes spacey multi-id lists and pairs nesting LIFO", () => {
    const result = migrateLegacyCommentMarkers("{%c: a , b %}x{%c:c%}y{%/c%}z{%/c%}\n");
    expect(result.body).toBe("%%m:a,b:start%%x%%m:c:start%%y%%m:c:end%%z%%m:a,b:end%%\n");
    expect(result.migrated).toBe(2);
  });

  it("leaves unpaired edges verbatim and reports them", () => {
    const openOnly = migrateLegacyCommentMarkers("a {%c:lost%} b\n");
    expect(openOnly.body).toBe("a {%c:lost%} b\n");
    expect(openOnly.unpaired).toBe(1);
    const closeOnly = migrateLegacyCommentMarkers("a {%/c%} b\n");
    expect(closeOnly.body).toBe("a {%/c%} b\n");
    expect(closeOnly.unpaired).toBe(1);
  });

  it("markers inside fences and inline code stay literal", () => {
    const fenced = "```\n{%c:a%}x{%/c%}\n```\n";
    expect(migrateLegacyCommentMarkers(fenced).body).toBe(fenced);
    const inline = "a `{%c:a%}x{%/c%}` b\n";
    expect(migrateLegacyCommentMarkers(inline).body).toBe(inline);
  });

  it("pairs across a fence: the range survives, the fenced example does not", () => {
    const md = "{%c:a%}open\n```\n{%/c%} literal\n```\nclose{%/c%}\n";
    const result = migrateLegacyCommentMarkers(md);
    expect(result.body).toBe("%%m:a:start%%open\n```\n{%/c%} literal\n```\nclose%%m:a:end%%\n");
  });
});

describe("comment footer", () => {
  const FOOTER =
    '\n<!--moss:comments\n{"c1":{"text":"hi","createdAt":1707900000000,"updatedAt":1707900000000,"imageUrl":"assets/a.png"}}\n-->';

  it("strips the footer and converts rows (ms → s, imageUrl → imageUrls)", () => {
    const extraction = extractCommentFooter(`body\n${FOOTER.slice(1)}`);
    expect(extraction.kind).toBe("found");
    if (extraction.kind !== "found") return;
    expect(extraction.body).toBe("body");
    expect(extraction.rows["c1"]).toMatchObject({
      text: "hi",
      createdAt: 1707900000,
      updatedAt: 1707900000,
      imageUrls: ["assets/a.png"],
    });
    expect(Object.hasOwn(extraction.rows["c1"] ?? {}, "imageUrl")).toBe(false);
  });

  it("seconds timestamps pass through unconverted", () => {
    const extraction = extractCommentFooter(
      'b\n<!--moss:comments\n{"c":{"text":"t","createdAt":1707900000,"updatedAt":1707900001}}\n-->',
    );
    expect(extraction.kind).toBe("found");
    if (extraction.kind !== "found") return;
    expect(extraction.rows["c"]?.createdAt).toBe(1707900000);
  });

  it("malformed JSON leaves the footer in place (never Moss's strip-anyway)", () => {
    const md = "b\n<!--moss:comments\n{broken\n-->";
    const extraction = extractCommentFooter(md);
    expect(extraction.kind).toBe("malformed");
    expect(extraction.body).toBe(md);
  });

  it("a footer with trailing content, or inside a fence, is not a footer", () => {
    const trailing =
      'b\n<!--moss:comments\n{"c":{"text":"t","createdAt":1,"updatedAt":1}}\n-->\nmore';
    expect(extractCommentFooter(trailing).kind).toBe("none");
    const fenced =
      '```\n<!--moss:comments\n{"c":{"text":"t","createdAt":1,"updatedAt":1}}\n-->\n```';
    expect(extractCommentFooter(fenced).kind).toBe("none");
  });
});

describe("lax forms", () => {
  it("normalizes spacey modern markers, skipping code spans", () => {
    const result = normalizeLaxMarkers("x %%m: a, b :start%% y `%%m: c :end%%` z\n");
    expect(result.body).toBe("x %%m:a,b:start%% y `%%m: c :end%%` z\n");
    expect(result.normalized).toBe(1);
  });

  it("normalizes tab-group spellings only inside a group", () => {
    const md = "::: tabs\n===  One\na\n::: \n\nprose\n===  not a label\n";
    const result = normalizeLaxTabs(md);
    expect(result.body).toBe(":::tabs\n=== One\na\n:::\n\nprose\n===  not a label\n");
    expect(result.normalized).toBe(3);
  });

  it("a setext underline outside a group is untouched", () => {
    const md = "Title\n===\n";
    expect(normalizeLaxTabs(md).body).toBe(md);
  });
});

describe("moss-html fence headers", () => {
  it("drops header options on an opening moss-html fence", () => {
    const result = normalizeMossHtmlHeaders("```moss-html width=400\n<p>x</p>\n```\n");
    expect(result.body).toBe("```moss-html\n<p>x</p>\n```\n");
    expect(result.normalized).toBe(1);
  });

  it("a moss-html header inside another fence is content", () => {
    const md = "````\n```moss-html width=400\n````\n";
    expect(normalizeMossHtmlHeaders(md).body).toBe(md);
  });
});

describe("importMossDoc", () => {
  const SIDECAR: CommentSidecar = {
    kept: { text: "sidecar wins", createdAt: 1, updatedAt: 1 },
  };

  it("composes: footer out, markers modern, lax normalized — and is idempotent", () => {
    const raw =
      '# T\n\n{%c:kept%}ranged{%/c%} and %%m: x :start%%y%%m: x :end%%\n\n<!--moss:comments\n{"kept":{"text":"footer copy","createdAt":2000000000000,"updatedAt":2000000000000},"fresh":{"text":"new","createdAt":2000000000000,"updatedAt":2000000000000}}\n-->';
    const first = importMossDoc(raw, SIDECAR);
    expect(first.body).toBe(
      "# T\n\n%%m:kept:start%%ranged%%m:kept:end%% and %%m:x:start%%y%%m:x:end%%\n",
    );
    expect(first.sidecar["kept"]?.text).toBe("sidecar wins");
    expect(first.sidecar["fresh"]?.createdAt).toBe(2000000000);
    expect(first.report.footerRowsAdded).toBe(1);
    expect(first.report.footerRowsSkipped).toBe(1);
    expect(first.bodyChanged).toBe(true);
    expect(first.sidecarChanged).toBe(true);

    const second = importMossDoc(first.body, first.sidecar);
    expect(second.bodyChanged).toBe(false);
    expect(second.sidecarChanged).toBe(false);
    expect(second.report).toMatchObject({
      legacyMarkerPairs: 0,
      footer: "none",
      laxMarkersNormalized: 0,
      tabsNormalized: 0,
      htmlHeadersNormalized: 0,
    });
  });

  it("a clean modern doc reports no changes", () => {
    const raw = "# T\n\n%%m:a:start%%x%%m:a:end%%\n";
    const result = importMossDoc(raw, {});
    expect(result.bodyChanged).toBe(false);
    expect(result.sidecarChanged).toBe(false);
    expect(result.report.warnings).toEqual([]);
  });
});
