// the headless page over the bridge: a page's bytes in, the item's article blocks out, and a
// block's three sides in, the editor's merge out, each under the load's nonce and the job's id. The
// reading itself is @repo/page-reader's, held over its corpus there and in a real browser by
// tools/e2e/src/scenarios/phone-editor-page.ts; jsdom's DOM stands in only for the plumbing here.

import { describe, expect, it } from "vitest";

import type { LibraryBlock } from "@repo/notes/library/library-nodes";

import { connectPageBridge } from "../bridge/page-bridge";
import { createFakePhone, PHONE_NONCE } from "../test-support/fake-phone";
import { mergeSides, readPage, serveHeadless } from "./headless-mode";

const PAGE = [
  "<!doctype html><html><head>",
  '<meta property="og:title" content="Café notes">',
  '<meta property="og:site_name" content="Field Notes">',
  "</head><body><article><h1>Café notes</h1>",
  "<p>Plain files outlive the apps that made them, and the café is where they were written.</p>",
  "</article></body></html>",
].join("");

// the page's bytes as the bridge carries them: latin-1, one byte a character below U+0100, and UTF-8
const latin1Base64 = (text: string): string => btoa(text);
const utf8Base64 = (text: string): string =>
  btoa(String.fromCodePoint(...new TextEncoder().encode(text)));

const paragraph = (id: string, text: string): LibraryBlock => ({
  children: [{ text }],
  id,
  type: "p",
});

const textsOf = (answer: ReturnType<typeof readPage>): string[] =>
  answer.kind === "read"
    ? answer.article.map(({ block }) =>
        block.children.map((child) => ("text" in child ? child.text : "")).join(""),
      )
    : [];

describe("the headless page's reader", () => {
  it("decodes a page by the charset its answer declared, and reads its facts and article", () => {
    const answer = readPage({
      base64: latin1Base64(PAGE),
      charset: "iso-8859-1",
      prefer: "article",
      url: "https://notes.example/cafe",
    });
    expect(answer).toMatchObject({ facts: { site: "Field Notes", title: "Café notes" } });
    expect(textsOf(answer).join("\n")).toContain("the café is where");
  });

  it("orders the article's blocks, each under an id of its own", () => {
    const answer = readPage({
      base64: utf8Base64(PAGE),
      charset: "utf-8",
      prefer: "article",
      url: "https://notes.example/cafe",
    });
    const article = answer.kind === "read" ? answer.article : [];
    expect(article.length).toBeGreaterThan(0);
    const ords = article.map(({ ord }) => ord);
    expect(ords).toStrictEqual(ords.toSorted());
    expect(new Set(article.map(({ block }) => block.id)).size).toBe(article.length);
  });

  it("reads a page for the text its job names, so a video keeps its description", () => {
    const answer = readPage({
      base64: utf8Base64(
        PAGE.replace("</head>", '<meta name="description" content="A talk."></head>'),
      ),
      charset: "utf-8",
      prefer: "description",
      url: "https://www.youtube.com/watch?v=abc123",
    });
    expect(textsOf(answer)).toStrictEqual(["A talk."]);
  });

  it("answers failed for bytes it cannot read, never an exception", () => {
    expect(
      readPage({ base64: "!!not base64!!", charset: null, prefer: "article", url: "https://a" }),
    ).toMatchObject({ kind: "failed" });
  });
});

describe("the headless page's merge", () => {
  it("keeps both devices' lines of one paragraph, under the cell's block's id", () => {
    const merged = mergeSides({
      base: paragraph("p1", "one\ntwo\nthree"),
      mine: paragraph("p1", "one, mine\ntwo\nthree"),
      theirs: paragraph("p1", "one\ntwo\nthree, theirs"),
    });
    expect(merged?.overlapped).toBe(false);
    expect(merged?.block).toMatchObject({ children: [{ text: "one, mine\ntwo\nthree, theirs" }] });
  });
});

describe("the headless page over the bridge", () => {
  it("answers each job by its id under the load's nonce", async () => {
    const phone = createFakePhone();
    const connecting = connectPageBridge(phone.transport);
    phone.deliver({ mode: "headless", nonce: PHONE_NONCE, type: "init" });
    const { bridge, init } = await connecting;
    expect(init.mode).toBe("headless");
    serveHeadless(bridge);
    phone.deliver({
      id: 7,
      job: {
        base64: utf8Base64(PAGE),
        charset: "utf-8",
        prefer: "article",
        url: "https://a.example",
      },
      nonce: PHONE_NONCE,
      type: "fillJob",
    });
    phone.deliver({
      id: 8,
      nonce: PHONE_NONCE,
      sides: {
        base: paragraph("p1", "a"),
        mine: paragraph("p1", "a, mine"),
        theirs: paragraph("p1", "a"),
      },
      type: "mergeJob",
    });
    const [answered] = phone.events("fillAnswer");
    expect(answered).toMatchObject({
      answer: { facts: { title: "Café notes" }, kind: "read" },
      id: 7,
      nonce: PHONE_NONCE,
    });
    const [merged] = phone.events("mergeAnswer");
    expect(merged).toMatchObject({
      id: 8,
      merged: { block: { children: [{ text: "a, mine" }] }, overlapped: false },
      nonce: PHONE_NONCE,
    });
  });
});
