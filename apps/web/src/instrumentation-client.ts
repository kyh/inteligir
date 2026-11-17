import { z } from "zod";

// Every document's policy refuses eval, and zod probes for it with `new Function` on its first
// parse, which the browser reports as a violation although zod catches the throw.
z.config({ jitless: true });
