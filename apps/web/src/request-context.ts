// What the Worker's entry hands Start with every request (./worker/server.ts): the service's doors,
// which each server route answers through. Types only and outside src/worker, so both programs
// load it, the site's as a root file and the Worker's through the entry's import, and the doors are
// named by their DOM-safe types alone (@repo/service/doors).

// tsgo refuses to augment a module no file of the program imports (TS2664), and the Worker's
// program otherwise reaches only `@tanstack/react-start/server-entry`
import type { Register } from "@tanstack/react-start";
import type { Doors } from "@repo/service/doors";

declare module "@tanstack/react-start" {
  interface Register {
    server: { requestContext: { doors: Doors } };
  }
}

export type RequestContext = Register["server"]["requestContext"];
