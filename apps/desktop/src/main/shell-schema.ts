import { Type } from "@sinclair/typebox";

import { shellSchema } from "@/shared/shell";

// On-disk variant of the shared shell schema (shared/shell.ts owns the shape
// definitions). WidgetSpec is validated via parseWidgetSpec (TypeBox + cycle
// check) at the boundary that produces it (install/update/patch in shell.ts).
// Each custom def's `spec` is kept as Unknown here so a malformed spec on
// disk doesn't reject the whole shell — consumers parseWidgetSpec it on
// access.
export const ShellSchema = shellSchema(Type.Unknown());
