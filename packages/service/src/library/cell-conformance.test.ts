// The account's cell answers the cases the fake cell is held to
// (`@repo/contract/test-support/cell-conformance`), each in a fresh cell through its own router as
// a laptop calls it, so a client's suite on the fake stands on what this cell does.

import { cellConformance } from "@repo/contract/test-support/cell-conformance";

import { cellIn, cellOf, clockAt, inCell } from "../test-support/library-cell";

cellConformance(async (run) => {
  await inCell(cellOf(), async (state) => {
    await run(cellIn(state, { clock: clockAt() }).client);
  });
});
