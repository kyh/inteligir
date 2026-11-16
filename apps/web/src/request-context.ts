// What the Worker's entry hands Start with every request (./worker/server.ts): the service, which
// each mount answers through, and whether the request is from someone signed in, which a page's
// guard asks as the Worker renders it. Types only and outside src/worker, so both programs load
// it, the site's as a root file and the Worker's through the entry's import, and both are typed by
// the platform's Request and Response alone, which each program resolves as its own.

// tsgo refuses to augment a module no file of the program imports (TS2664), and the Worker's
// program otherwise reaches only `@tanstack/react-start/server-entry`
import type { Register } from "@tanstack/react-start";

declare module "@tanstack/react-start" {
  interface Register {
    server: {
      requestContext: {
        service: (request: Request) => Promise<Response>;
        signedIn: () => Promise<boolean>;
      };
    };
  }
}

export type RequestContext = Register["server"]["requestContext"];
