#!/usr/bin/env node
// Pre-publish bin: the workspace is source-consumed, so run the TS entry
// through tsx's module hooks. Phase 7 (npm packaging) replaces this with a
// compiled dist import.
import { register } from "tsx/esm/api";

register();
await import("../src/main.ts");
