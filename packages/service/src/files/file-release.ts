// A file the library lets go, its object removed from the store by a `file-release` job. The
// object's pathname is its upload's own, so the same bytes uploaded again land at another and never
// meet the removal.

import { z } from "zod";

import type { JobRun } from "../jobs/job-kinds";
import { FILE_STORE } from "./file-store-of";

const releaseSchema = z.object({ pathname: z.string() });

// the store's removal, again until it goes through, each failure logged by the drain
export const RELEASE_RUN: JobRun<z.output<typeof releaseSchema>> = {
  payload: releaseSchema,
  run: async ({ pathname }) => {
    await FILE_STORE.remove(pathname);
    return "done";
  },
  tries: { kind: "until-done" },
};
