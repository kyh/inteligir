// A page's html read on a host that has no DOM of its own, the cloud's fill: the one reading
// (`./extract-page`) over linkedom (`./linkedom-page`), typed by its DOM-free signature
// (`./read-html-api`), which a program with no DOM (the Worker's) reads through this entry's
// `types` condition.

import { extractPageBlocks } from "./extract-page";
import { parsePage } from "./linkedom-page";
import type { ReadHtml } from "./read-html-api";

export const readHtml: ReadHtml = (args, newBlockId) =>
  extractPageBlocks(args, parsePage, newBlockId);
