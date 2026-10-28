import type {
  InferRouterContractInputs,
  InferRouterContractOutputs,
  RouterContractClient,
} from "@orpc/contract";
import { expectTypeOf, test } from "vitest";

import type { libraryContract } from "@repo/contract/cloud/library/library-contract";

import type { libraryTools } from "./library-tools";

// the cell implements the decorated rows while every app types its client against the plain
// contract, which holds only while `.meta()` leaves each row's types as they were
test("decorating the library's rows as tools leaves every client type as the contract's", () => {
  expectTypeOf<RouterContractClient<typeof libraryTools>>().toEqualTypeOf<
    RouterContractClient<typeof libraryContract>
  >();
});

test("and every input and output with it", () => {
  expectTypeOf<InferRouterContractInputs<typeof libraryTools>>().toEqualTypeOf<
    InferRouterContractInputs<typeof libraryContract>
  >();
  expectTypeOf<InferRouterContractOutputs<typeof libraryTools>>().toEqualTypeOf<
    InferRouterContractOutputs<typeof libraryContract>
  >();
});
