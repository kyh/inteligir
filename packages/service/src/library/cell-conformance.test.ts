import { cellConformance } from "@repo/contract/test-support/cell-conformance.test-utils";
import { dbSuite } from "@repo/db/test-database";
import { expect } from "vitest";

import { drainJobs } from "../jobs/drain-jobs";
import { JOB_RUNS } from "../jobs/job-kinds";
import { putTo, sha256Hex } from "../test-support/file-uploads.test-utils";
import { personalLibrary } from "../test-support/library.fixture";

const NO_FILL = async () => {
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
