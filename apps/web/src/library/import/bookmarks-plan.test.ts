import { describe, expect, it } from "vitest";

import { parseBookmarksHtml } from "./bookmarks-plan";
import { planRaindropImport } from "./raindrop-plan";

const CHROME = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file. -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1700000000" LAST_MODIFIED="0" PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>
    <DL><p>
        <DT><A HREF="https://example.com/a" ADD_DATE="1700000100">Fish &amp; chips</A>
        <DT><H3 ADD_DATE="1700000000">Reading</H3>
        <DL><p>
            <DT><A HREF="https://example.com/b" ADD_DATE="1700000200" TAGS="later,long reads">Essay</A>
            <DD>Worth a second look
            <DT><A HREF="javascript:alert(1)">A bookmarklet</A>
        </DL><p>
    </DL><p>
    <DT><H3>Other bookmarks</H3>
    <DL><p>
        <DT><A HREF="https://example.com/c">Kept elsewhere</A>
    </DL><p>
</DL><p>`;

describe("a browser's bookmarks file", () => {
  it("reads each bookmark with its folder, date, tags and description, past the browser's own top folders", () => {
    expect(parseBookmarksHtml(CHROME)).toStrictEqual({
      ok: true,
      rows: [
        {
          cover: null,
          created: "1700000100",
          excerpt: "",
          favorite: false,
          folder: [],
          highlights: [],
          note: "",
          tags: [],
          title: "Fish & chips",
          url: "https://example.com/a",
        },
        {
          cover: null,
          created: "1700000200",
          excerpt: "Worth a second look",
          favorite: false,
          folder: ["Reading"],
          highlights: [],
          note: "",
          tags: ["later", "long reads"],
          title: "Essay",
          url: "https://example.com/b",
        },
        {
          cover: null,
          created: null,
          excerpt: "",
          favorite: false,
          folder: [],
          highlights: [],
          note: "",
          tags: [],
          title: "Kept elsewhere",
          url: "https://example.com/c",
        },
      ],
      skipped: 1,
    });
  });

  it("plans the bookmarks as saved links, dated as they were added", () => {
    const parsed = parseBookmarksHtml(CHROME);
    const plan = parsed.ok ? planRaindropImport(parsed.rows, 0) : null;
    expect(
      plan?.items.map(({ folder, savedMs, tags, url }) => ({ folder, savedMs, tags, url })),
    ).toStrictEqual([
      { folder: null, savedMs: 1_700_000_100_000, tags: [], url: "https://example.com/a" },
      {
        folder: "Reading",
        savedMs: 1_700_000_200_000,
        tags: ["later", "long-reads"],
        url: "https://example.com/b",
      },
      { folder: null, savedMs: 0, tags: [], url: "https://example.com/c" },
    ]);
  });

  it("keeps a folder the file holds at its top that no browser makes", () => {
    const parsed = parseBookmarksHtml(
      `<DL><p><DT><H3>Recipes</H3><DL><p><DT><A HREF="https://example.com/r">Bread</A></DL><p></DL><p>`,
    );

    expect(parsed).toMatchObject({ ok: true, rows: [{ folder: ["Recipes"], title: "Bread" }] });
  });

  it("turns down a file that isn't bookmarks, or holds none", () => {
    expect(parseBookmarksHtml("title,url\nA,https://example.com")).toStrictEqual({
      ok: false,
      reason: "not-bookmarks",
    });
    expect(parseBookmarksHtml("<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p></DL>")).toStrictEqual({
      ok: false,
      reason: "empty",
    });
  });
});
