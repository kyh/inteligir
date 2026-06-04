// Tiny adapter so TypeBox schemas plug into tanstack-form (which expects
// Standard Schema-shaped validators). TypeBox doesn't ship the `~standard`
// descriptor itself yet, so we synthesize one here.

import { type Static, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

type StandardIssue = { message: string; path?: ReadonlyArray<string | number> };

type StandardResult<T> = { value: T; issues: undefined } | { issues: readonly StandardIssue[] };

type StandardSchemaV1<Input, Output = Input> = {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown,
    ) => StandardResult<Output> | Promise<StandardResult<Output>>;
    readonly types?: { readonly input: Input; readonly output: Output };
  };
};

/** Wrap a TypeBox schema so tanstack-form's standard-schema validator accepts it. */
export function tb<S extends TSchema>(schema: S): StandardSchemaV1<Static<S>> {
  return {
    "~standard": {
      version: 1,
      vendor: "typebox",
      validate: (value: unknown) => {
        if (Value.Check(schema, value)) {
          return { value, issues: undefined };
        }
        const issues: StandardIssue[] = [];
        for (const err of Value.Errors(schema, value)) {
          const path = err.path ? err.path.split("/").filter(Boolean) : [];
          issues.push({ message: err.message, path });
        }
        return { issues };
      },
    },
  };
}
