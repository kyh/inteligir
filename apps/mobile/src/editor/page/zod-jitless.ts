// zod compiles each object parser with `Function`, deciding as the schema is built, at import, and
// the page's policy refuses `Function`, so every parse past it would throw; this is the page's
// first import, so it runs before any module builds a schema.

import { z } from "zod";

z.config({ jitless: true });
