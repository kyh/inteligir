// The account's cell answers the cases the fake cell is held to
// (`@repo/contract/test-support/cell-conformance`), each on a fresh account through the library's
// router as a person's session calls it, its files sent up through reserve, the store's PUT and
// settle, and its due jobs run by the drain, so a client's suite on the fake stands on what the
// cloud does.

import { cellConformance } from "@repo/contract/test-support/cell-conformance";
import { dbSuite } from "@repo/db/test-database";
import { expect } from "vitest";

import { drainJobs } from "../jobs/drain-jobs";
import { JOB_RUNS } from "../jobs/job-kinds";
import { putTo, sha256Hex } from "../test-support/file-uploads";
import { personalLibrary } from "../test-support/library-fixture";

// a fill reads the web, which only the fill's own suites serve, so a shared case that leaves one
// due fails as it runs
const NO_FILL = async (): Promise<never> => {
  throw new Error("a shared case left a fill due, which reads the web");
};

dbSuite("the account's cell", () => {
  cellConformance(async (run) => {
    const { accountId, library } = await personalLibrary();
    await run({
      library,
      runDue: async () => {
        await expect(
          drainJobs({ accountId, budgetMs: 50_000, runs: { ...JOB_RUNS, fill: NO_FILL } }),
        ).resolves.toMatchObject({ dropped: 0, failed: 0 });
      },
      upload: async (bytes, mime) => {
        const sha = sha256Hex(bytes);
        const reserved = await library.files.reserve({ bytes: bytes.byteLength, mime, sha });
        if (reserved.kind === "upload") {
          const stored = await putTo(reserved.url, bytes, mime);
          expect(stored.status).toBe(200);
          await library.files.settle({ sha, uploadId: reserved.uploadId });
        }
        return sha;
      },
    });
  });
});
