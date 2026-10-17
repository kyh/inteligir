// the page capture executeScript injects: the rendered DOM, cloned without scripts or form values,
// with its selection, as the /browser wire's captured page (§8.6). It runs in the extension's
// isolated world, so the page's own scripts can neither see nor replace the function it defines;
// the service worker's second executeScript calls it with the save's options.

import type { CapturedPageWire } from "@repo/contract/browser/browser-wire";
import { serializePage } from "./serialize-page";
import type { CaptureOptions } from "./serialize-page";

declare global {
  interface Window {
    inteligirCapture?: (options: CaptureOptions) => CapturedPageWire;
  }
}

window.inteligirCapture = (options) => serializePage(document, window.getSelection(), options);
