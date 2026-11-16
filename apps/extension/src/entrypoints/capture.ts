// the page capture executeScript injects: the rendered DOM, cloned without scripts or form values,
// answered as the script's own value. It runs in the extension's isolated world, so the page's own
// scripts can neither see nor replace it.

import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";

import { serializePage } from "../capture/serialize-page";

// an unlisted script, so WXT writes it as capture.js, one IIFE with everything it imports inlined,
// and hands what main() returns to the executeScript that injected it
export default defineUnlistedScript({ main: () => serializePage(document) });
