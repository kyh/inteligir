// the page capture executeScript injects: the rendered DOM, cloned without scripts or form values.
// It runs in the extension's isolated world, so the page's own scripts can
// neither see nor replace the function it defines; the service worker's second executeScript calls
// it with the caps.

import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";

import type { CaptureOptions, CapturedPage } from "../capture/captured-page";
import { serializePage } from "../capture/serialize-page";

declare global {
  interface Window {
    inteligirCapture?: (options: CaptureOptions) => CapturedPage;
  }
}

// an unlisted script, so WXT writes it as capture.js, one IIFE with everything it imports inlined
export default defineUnlistedScript(() => {
  window.inteligirCapture = (options) => serializePage(document, options);
});
