// oxlint-disable unicorn/prefer-module -- expo's PostCSS loader requires this file; the package is not type: module
// The note page's fonts as data: URIs, each face's woff2 alone: Expo's Metro CSS leaves a local
// url() as written, an update ships no public assets, and every engine the page runs in reads
// woff2, so the woff and ttf beside it would only weigh the sheet down.
const fs = require("node:fs");
const path = require("node:path");

const SOURCE =
  /url\((?<quote>['"]?)(?<file>[^'")]+)\k<quote>\)\s*format\((?<fq>['"])(?<format>[^'"]+)\k<fq>\)/gu;

const inlineFonts = () => ({
  AtRule: {
    "font-face": (rule, { result }) => {
      const base = path.dirname(result.opts.from ?? "");
      rule.walkDecls("src", (decl) => {
        const kept = [];
        for (const match of decl.value.matchAll(SOURCE)) {
          const file = match.groups?.file ?? "";
          const format = match.groups?.format ?? "";
          if (!format.startsWith("woff2") || /^(?:data|https?):/u.test(file)) {
            continue;
          }
          const bytes = fs.readFileSync(path.resolve(base, file.split(/[?#]/u)[0] ?? ""));
          kept.push(`url(data:font/woff2;base64,${bytes.toString("base64")}) format("${format}")`);
        }
        if (kept.length > 0) {
          decl.value = kept.join(",");
        }
      });
    },
  },
  postcssPlugin: "inline-fonts",
});
inlineFonts.postcss = true;
module.exports = inlineFonts;
