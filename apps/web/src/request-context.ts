// What the Worker's entry hands Start with every request (./worker/server.ts): the service, which
// each mount answers through. Types only and outside src/worker, so both programs load it, the
// site's as a root file and the Worker's through the entry's import, and the service is typed by the
// platform's Request and Response alone, which each program resolves as its own.

// tsgo refuses to augment a module no file of the program imports (TS2664), and the Worker's
// program otherwise reaches only `@tanstack/react-start/server-entry`
import type { Register } from "@tanstack/react-start";

declare module "@tanstack/react-start" {
  interface Register {
    server: { requestContext: { service: (request: Request) => Promise<Response> } };
  }
}

export type RequestContext = Register["server"]["requestContext"];
