import type { Scenario } from "../harness/scenario";
import { ScenarioSkipError } from "../harness/scenario-skip-error";

export const raindropImport: Scenario = {
  description:
    "import raindrop puts a backup's links in their folders with their tags and pins, its highlights wait on their stubs, a re-import adds nothing, and the hosted library takes it in batches",
  name: "raindrop-import",
  run: () =>
    Promise.reject(new ScenarioSkipError("PIVOT-STUB(S3): raindrop-import not written yet")),
};
