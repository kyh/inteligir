// The account's cell answers the cases the fake cell is held to
// (`@repo/contract/test-support/cell-conformance`), each on a fresh account through the library's
// router as a person's session calls it, so a client's suite on the fake stands on what the cloud
// does.

import { cellConformance } from "@repo/contract/test-support/cell-conformance";
import { dbSuite } from "@repo/db/test-database";

import { personalLibrary } from "../test-support/library-fixture";

dbSuite("the account's cell", () => {
  cellConformance(async (run) => {
    const { library } = await personalLibrary();
    await run(library);
  });
});
