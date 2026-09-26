import { describe, expect, it } from "vitest";

import { classicPageProblems, toClassicPage } from "../classic-page";

// the head vite writes for an app build, entry and stylesheet alike marked for a CORS fetch
const VITE_HEAD = `<head>
    <meta charset="utf-8" />
    <title>inteligir</title>
    <script type="module" crossorigin src="./assets/index-abc.js"></script>
    <link rel="stylesheet" crossorigin href="./assets/style-abc.css">
  </head>`;

describe("the page the phone loads from file://", () => {
  it("is vite's entry rewritten to one deferred classic script and a plain stylesheet", () => {
    const page = toClassicPage(VITE_HEAD);
    expect(page).toContain('<script defer src="./assets/index-abc.js"></script>');
    expect(page).toContain('<link rel="stylesheet" href="./assets/style-abc.css">');
    expect(classicPageProblems(page)).toEqual([]);
  });

  it("fails the build on a module script", () => {
    expect(classicPageProblems('<script type="module" src="./a.js"></script>')).toEqual([
      'a script is type="module", which a file:// page cannot load',
    ]);
  });

  it("fails the build on more than one script, or none", () => {
    expect(
      classicPageProblems('<script defer src="./a.js"></script><script src="./b.js"></script>'),
    ).toEqual(["the page references 2 scripts, and it must load exactly one"]);
    expect(classicPageProblems("<head></head>")).toEqual([
      "the page references 0 scripts, and it must load exactly one",
    ]);
  });

  it("fails the build on a CORS fetch or a second chunk", () => {
    expect(
      classicPageProblems(
        '<script defer src="./a.js"></script><link rel="modulepreload" crossorigin href="./b.js">',
      ),
    ).toEqual([
      "a tag is marked crossorigin, so its fetch is a CORS request file:// cannot answer",
      "a modulepreload link names a second chunk",
    ]);
  });
});
