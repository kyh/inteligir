// Nothing turns on vitest's `globals`, so Testing Library never registers its own auto-cleanup, and
// a Plate tree left mounted fires slate-react's throttled selection handler into a torn-down DOM.

import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);

// a three-core CI runner running four suites at once misses testing-library's one-second default
configure({ asyncUtilTimeout: 5000 });

// jsdom answers no media query, and the theme reads prefers-color-scheme
Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: (query: string): MediaQueryList => ({
    addEventListener: () => {},
    addListener: () => {},
    dispatchEvent: () => false,
    matches: false,
    media: query,
    onchange: null,
    removeEventListener: () => {},
    removeListener: () => {},
  }),
});
