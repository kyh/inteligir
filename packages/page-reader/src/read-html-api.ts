// `./read-html`'s signature as a program with no DOM sees it: the package's `types` condition for
// that entry (package.json), so the Worker's program (apps/web/src/worker/tsconfig.json), typed
// without a DOM, types its calls by the function's own declaration, and `./read-html`'s
// implementation is held to this type by this package's program, which has the DOM. The bundler
// reads the `default` condition, the implementation itself.

import type { PageArgs } from "./page-facts";
import type { ExtractedPageBlocks } from "./page-reading";

// a page's html read into its facts and its article as the library's blocks, named by the host's ids
export type ReadHtml = (args: PageArgs, newBlockId: () => string) => ExtractedPageBlocks;

export declare const readHtml: ReadHtml;
