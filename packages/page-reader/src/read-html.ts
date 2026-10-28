// A page's html read on a host that has no DOM of its own, the cloud's fill: the one reading
// (`./extract-page`) over linkedom (`./linkedom-page`), behind a signature whose types name no DOM
// (`./page-facts`, `./page-reading`), so a program typed without one (the Worker's,
// apps/web/src/worker/tsconfig.json) can call it.

import { extractPageBlocks } from "./extract-page";
import { parsePage } from "./linkedom-page";
import type { PageArgs } from "./page-facts";
import type { ExtractedPageBlocks } from "./page-reading";

export const readHtml = (args: PageArgs, newBlockId: () => string): ExtractedPageBlocks =>
  extractPageBlocks(args, parsePage, newBlockId);
