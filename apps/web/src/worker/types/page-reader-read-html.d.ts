// @repo/page-reader's reading reaches the DOM's lib through its own code (it walks the document
// linkedom parses, typed by the DOM's globals), which would type this program against a stdlib the
// Worker never runs on. The Worker calls only `readHtml`, whose types name no DOM
// (`@repo/page-reader/page-facts`, `@repo/page-reader/page-reading`), so the worker tsconfig's
// `paths` maps that one module here, its signature restated; the package's own program checks the
// function against these types, and the bundler, which ignores `paths`, loads the real one.

import type { PageArgs } from "@repo/page-reader/page-facts";
import type { ExtractedPageBlocks } from "@repo/page-reader/page-reading";

export declare const readHtml: (args: PageArgs, newBlockId: () => string) => ExtractedPageBlocks;
