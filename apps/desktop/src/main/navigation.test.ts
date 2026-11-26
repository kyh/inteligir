import { assert, describe, test } from "vitest";

import { classify, opensExternally, reloadTarget, savePathOf } from "./navigation";

const SITE = "https://inteligir.com/library";
const LOCAL = "http://localhost:5174/library";

describe("the window's pin", () => {
  test("keeps every page of the site", () => {
    assert.strictEqual(classify("https://inteligir.com/library/settings", SITE), "allow");
    assert.strictEqual(
      classify("https://inteligir.com/app/sign-in?next=%2Flibrary", SITE),
      "allow",
    );
  });

  test("compares origins, not prefixes", () => {
    assert.strictEqual(classify("http://localhost:51740/library", LOCAL), "open-externally");
    assert.strictEqual(classify("https://localhost:5174/library", LOCAL), "open-externally");
    assert.strictEqual(classify("https://inteligir.com.evil/library", SITE), "open-externally");
  });

  test("lets a blob the page made load as its save, and no other", () => {
    assert.strictEqual(classify("blob:https://inteligir.com/065f281d-fbc4", SITE), "allow");
    assert.strictEqual(classify("blob:https://example.com/065f281d-fbc4", SITE), "deny");
    assert.strictEqual(classify("blob:null/065f281d-fbc4", SITE), "deny");
  });

  test("lets frames load their blank documents", () => {
    assert.strictEqual(classify("about:srcdoc", SITE), "allow");
    assert.strictEqual(classify("about:blank", SITE), "allow");
    assert.strictEqual(classify("about:config", SITE), "deny");
  });

  test("opens other web pages in the browser and refuses the rest", () => {
    assert.strictEqual(classify("https://example.com/", SITE), "open-externally");
    assert.strictEqual(classify("file:///etc/passwd", SITE), "deny");
    assert.strictEqual(classify("data:text/html,hi", SITE), "deny");
    assert.strictEqual(classify("mailto:a@example.com", SITE), "deny");
    assert.strictEqual(classify("not a url", SITE), "deny");
  });

  test("opens no second window and hands a web page to the browser", () => {
    assert.strictEqual(opensExternally("https://example.com/"), true);
    assert.strictEqual(opensExternally("https://inteligir.com/licenses.md"), true);
    assert.strictEqual(opensExternally("blob:https://inteligir.com/065f281d-fbc4"), false);
    assert.strictEqual(opensExternally("about:blank"), false);
    assert.strictEqual(opensExternally("mailto:a@example.com"), false);
  });
});

describe("View › Reload", () => {
  test("reloads the page shown while it is the site's", () => {
    assert.strictEqual(
      reloadTarget("https://inteligir.com/library/settings?scope=all", SITE),
      "shown",
    );
    assert.strictEqual(
      reloadTarget("https://inteligir.com/app/sign-in?next=%2Flibrary", SITE),
      "shown",
    );
  });

  test("goes to the site when the window shows none of it", () => {
    assert.strictEqual(reloadTarget("", SITE), "site");
    assert.strictEqual(reloadTarget("about:blank", SITE), "site");
    assert.strictEqual(reloadTarget("http://localhost:51740/library", LOCAL), "site");
  });
});

describe("a download", () => {
  test("lands under its own name, or the first one free", () => {
    const taken = new Set(["/dl/notes.zip", "/dl/notes (1).zip"]);
    assert.strictEqual(
      savePathOf("/dl", "report.pdf", (candidate) => taken.has(candidate)),
      "/dl/report.pdf",
    );
    assert.strictEqual(
      savePathOf("/dl", "notes.zip", (candidate) => taken.has(candidate)),
      "/dl/notes (2).zip",
    );
  });

  test("stays in the folder whatever its name says", () => {
    assert.strictEqual(
      savePathOf("/dl", "../../etc/passwd", () => false),
      "/dl/passwd",
    );
    assert.strictEqual(
      savePathOf("/dl", "", () => false),
      "/dl/download",
    );
  });
});
