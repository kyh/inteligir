// the reader mode over the bridge: a page's bytes in, what the reader made of them out, under the
// load's nonce and the job's id. The reading itself is @repo/page-reader's, held over its corpus
// there and in a real browser by tools/e2e/src/scenarios/phone-editor-page.ts; jsdom's DOM stands
// in only for the plumbing here.

import { describe, expect, it } from "vitest";

import { connectPageBridge } from "../bridge/page-bridge";
import { createFakePhone, PHONE_NONCE } from "../test-support/fake-phone";
import { readPage, serveFills } from "./serve-fills";

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

describe("the page's reader mode", () => {
  it("decodes a page by the charset its answer declared and reads its facts and article", () => {
    const answer = readPage({
      base64: latin1Base64(PAGE),
      charset: "iso-8859-1",
      prefer: "article",
      url: "https://notes.example/cafe",
    });
    expect(answer).toMatchObject({ facts: { site: "Field Notes", title: "Café notes" } });
    expect(answer.kind === "read" ? answer.article : "").toContain("the café is where");
  });

  it("answers failed for bytes it cannot read, never an exception", () => {
    expect(
      readPage({ base64: "!!not base64!!", charset: null, prefer: "article", url: "https://a" }),
    ).toMatchObject({ kind: "failed" });
  });

  it("answers each job by its id under the load's nonce", async () => {
    const phone = createFakePhone();
    const connecting = connectPageBridge(phone.transport);
    phone.deliver({ mode: "fill", nonce: PHONE_NONCE, type: "init" });
    const { bridge, init } = await connecting;
    expect(init.mode).toBe("fill");
    serveFills(bridge);
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
    const [answered] = phone.events("fillAnswer");
    expect(answered).toMatchObject({
      answer: { facts: { title: "Café notes" }, kind: "read" },
      id: 7,
      nonce: PHONE_NONCE,
    });
  });
});
